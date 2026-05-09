// Space Invaders — retro terminal style

(function () {
    const canvas = document.getElementById('game-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    const W = canvas.width;
    const H = canvas.height;

    const overlay = document.getElementById('game-overlay');
    const overlayTitle = document.getElementById('overlay-title');
    const overlaySub = document.getElementById('overlay-sub');
    const hudScore = document.getElementById('hud-score');
    const hudHi = document.getElementById('hud-hi');
    const hudLives = document.getElementById('hud-lives');
    const hudWave = document.getElementById('hud-wave');

    const GREEN = '#00ff66';
    const GREEN_DIM = '#0d8a3a';
    const RED = '#ff3030';
    const AMBER = '#ffb000';

    // ---------- Sprites (1 = lit pixel) ----------
    const PX = 3; // pixel size in canvas units
    const ALIEN_A = [
        [0,0,1,0,0,0,0,0,1,0,0],
        [0,0,0,1,0,0,0,1,0,0,0],
        [0,0,1,1,1,1,1,1,1,0,0],
        [0,1,1,0,1,1,1,0,1,1,0],
        [1,1,1,1,1,1,1,1,1,1,1],
        [1,0,1,1,1,1,1,1,1,0,1],
        [1,0,1,0,0,0,0,0,1,0,1],
        [0,0,0,1,1,0,1,1,0,0,0]
    ];
    const ALIEN_B = [
        [0,0,1,0,0,0,0,0,1,0,0],
        [1,0,0,1,0,0,0,1,0,0,1],
        [1,0,1,1,1,1,1,1,1,0,1],
        [1,1,1,0,1,1,1,0,1,1,1],
        [1,1,1,1,1,1,1,1,1,1,1],
        [0,1,1,1,1,1,1,1,1,1,0],
        [0,0,1,0,0,0,0,0,1,0,0],
        [0,1,0,0,0,0,0,0,0,1,0]
    ];
    const PLAYER_SPRITE = [
        [0,0,0,0,0,1,0,0,0,0,0],
        [0,0,0,0,1,1,1,0,0,0,0],
        [0,0,0,0,1,1,1,0,0,0,0],
        [0,1,1,1,1,1,1,1,1,1,0],
        [1,1,1,1,1,1,1,1,1,1,1],
        [1,1,1,1,1,1,1,1,1,1,1],
        [1,1,1,1,1,1,1,1,1,1,1]
    ];

    function drawSprite(sprite, x, y, color = GREEN, scale = PX) {
        ctx.fillStyle = color;
        for (let r = 0; r < sprite.length; r++) {
            for (let c = 0; c < sprite[r].length; c++) {
                if (sprite[r][c]) {
                    ctx.fillRect(x + c * scale, y + r * scale, scale, scale);
                }
            }
        }
    }

    function spriteW(sprite, scale = PX) { return sprite[0].length * scale; }
    function spriteH(sprite, scale = PX) { return sprite.length * scale; }

    // ---------- State ----------
    const HI_KEY = 'invaders_hi';
    const state = {
        mode: 'idle', // 'idle' | 'playing' | 'paused' | 'dead' | 'win' | 'gameover'
        wave: 1,
        score: 0,
        hi: parseInt(localStorage.getItem(HI_KEY) || '0', 10),
        lives: 3,
        player: null,
        bullets: [],
        eBullets: [],
        aliens: [],
        alienDir: 1,
        alienStepTimer: 0,
        alienStepInterval: 700, // ms — speeds up as aliens die
        animFrame: 0,
        keys: { left: false, right: false, fire: false },
        lastFrame: 0,
        lastFire: 0,
        diedAt: 0
    };

    function resetPlayer() {
        const w = spriteW(PLAYER_SPRITE);
        state.player = {
            x: W / 2 - w / 2,
            y: H - 60,
            w,
            h: spriteH(PLAYER_SPRITE),
            speed: 280
        };
    }

    function spawnAliens(wave) {
        state.aliens = [];
        const cols = 9;
        const rows = 5;
        const sw = spriteW(ALIEN_A);
        const sh = spriteH(ALIEN_A);
        const gapX = 18;
        const gapY = 14;
        const totalW = cols * sw + (cols - 1) * gapX;
        const startX = (W - totalW) / 2;
        const startY = 60;
        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                state.aliens.push({
                    x: startX + c * (sw + gapX),
                    y: startY + r * (sh + gapY),
                    w: sw,
                    h: sh,
                    row: r,
                    alive: true,
                    points: r === 0 ? 50 : r < 3 ? 20 : 10
                });
            }
        }
        state.alienDir = 1;
        state.alienStepInterval = Math.max(140, 700 - (wave - 1) * 60);
        state.alienStepTimer = 0;
    }

    function startGame() {
        state.mode = 'playing';
        state.score = 0;
        state.lives = 3;
        state.wave = 1;
        state.bullets = [];
        state.eBullets = [];
        resetPlayer();
        spawnAliens(state.wave);
        hideOverlay();
        updateHud();
    }

    function nextWave() {
        state.wave += 1;
        state.bullets = [];
        state.eBullets = [];
        resetPlayer();
        spawnAliens(state.wave);
        showOverlay('> WAVE_' + String(state.wave).padStart(2, '0'), 'press <span class="accent">SPACE</span> to engage', false);
        state.mode = 'idle';
        updateHud();
    }

    function gameOver() {
        if (state.score > state.hi) {
            state.hi = state.score;
            localStorage.setItem(HI_KEY, String(state.hi));
        }
        state.mode = 'gameover';
        showOverlay('> GAME_OVER', 'final score: <span class="accent">' + pad(state.score) + '</span> &nbsp; press <span class="accent">R</span> to restart');
        updateHud();
    }

    function showOverlay(title, sub, withControls = true) {
        overlay.classList.remove('hidden');
        overlayTitle.innerHTML = title;
        overlaySub.innerHTML = sub;
        document.querySelector('.overlay-controls').style.display = withControls ? '' : 'none';
    }
    function hideOverlay() {
        overlay.classList.add('hidden');
    }

    function pad(n) { return String(n).padStart(4, '0'); }
    function updateHud() {
        hudScore.textContent = pad(state.score);
        hudHi.textContent = pad(state.hi);
        hudLives.textContent = String(state.lives);
        hudWave.textContent = String(state.wave);
    }

    // ---------- Input ----------
    function handleKey(e, down) {
        const gameActive = document.getElementById('game').classList.contains('active');
        if (!gameActive) return;

        let used = true;
        switch (e.key) {
            case 'ArrowLeft': case 'a': case 'A': state.keys.left = down; break;
            case 'ArrowRight': case 'd': case 'D': state.keys.right = down; break;
            case ' ': case 'Spacebar':
                state.keys.fire = down;
                if (down && state.mode === 'idle') startOrAdvance();
                break;
            case 'p': case 'P':
                if (down) togglePause();
                break;
            case 'r': case 'R':
                if (down) startGame();
                break;
            default: used = false;
        }
        if (used) e.preventDefault();
    }

    function startOrAdvance() {
        if (state.mode !== 'idle') return;
        const anyAlive = state.aliens.some(a => a.alive);
        if (!anyAlive) {
            startGame();
        } else {
            state.mode = 'playing';
            hideOverlay();
        }
    }

    function togglePause() {
        if (state.mode === 'playing') {
            state.mode = 'paused';
            showOverlay('> PAUSED', 'press <span class="accent">P</span> to resume');
        } else if (state.mode === 'paused') {
            state.mode = 'playing';
            hideOverlay();
        }
    }

    document.addEventListener('keydown', e => handleKey(e, true));
    document.addEventListener('keyup', e => handleKey(e, false));

    // ---------- Update ----------
    function update(dt) {
        if (state.mode !== 'playing') return;

        // Player movement
        const p = state.player;
        if (state.keys.left)  p.x -= p.speed * dt;
        if (state.keys.right) p.x += p.speed * dt;
        p.x = Math.max(10, Math.min(W - p.w - 10, p.x));

        // Player firing (rate-limited)
        const now = performance.now();
        if (state.keys.fire && now - state.lastFire > 320 && state.bullets.length < 2) {
            state.bullets.push({
                x: p.x + p.w / 2 - 1,
                y: p.y - 4,
                w: 2,
                h: 12,
                vy: -520
            });
            state.lastFire = now;
        }

        // Bullets
        state.bullets.forEach(b => b.y += b.vy * dt);
        state.bullets = state.bullets.filter(b => b.y + b.h > 0);

        // Alien step
        state.alienStepTimer += dt * 1000;
        if (state.alienStepTimer >= state.alienStepInterval) {
            state.alienStepTimer = 0;
            state.animFrame ^= 1;
            stepAliens();
        }

        // Alien firing
        if (Math.random() < 0.012 + state.wave * 0.003) {
            const shooters = bottomMostAliens();
            if (shooters.length) {
                const a = shooters[Math.floor(Math.random() * shooters.length)];
                state.eBullets.push({
                    x: a.x + a.w / 2 - 1,
                    y: a.y + a.h,
                    w: 2,
                    h: 10,
                    vy: 220 + state.wave * 15
                });
            }
        }
        state.eBullets.forEach(b => b.y += b.vy * dt);
        state.eBullets = state.eBullets.filter(b => b.y < H);

        // Collisions: player bullets -> aliens
        for (const b of state.bullets) {
            for (const a of state.aliens) {
                if (!a.alive) continue;
                if (rectHit(b, a)) {
                    a.alive = false;
                    b.y = -100; // mark dead
                    state.score += a.points;
                    // Speed up wave as numbers drop
                    const aliveCount = state.aliens.filter(x => x.alive).length;
                    state.alienStepInterval = Math.max(80, (700 - (state.wave - 1) * 60) * (aliveCount / (state.aliens.length || 1) + 0.1));
                    break;
                }
            }
        }
        state.bullets = state.bullets.filter(b => b.y > -50);

        // Collisions: enemy bullets -> player
        for (const b of state.eBullets) {
            if (rectHit(b, state.player)) {
                b.y = H + 100;
                killPlayer();
                break;
            }
        }
        state.eBullets = state.eBullets.filter(b => b.y < H + 20);

        // Win condition
        if (state.aliens.every(a => !a.alive)) {
            nextWave();
            return;
        }

        // Lose: aliens reach player line
        const lowest = Math.max(...state.aliens.filter(a => a.alive).map(a => a.y + a.h));
        if (lowest >= state.player.y - 4) {
            killPlayer(true);
        }

        updateHud();
    }

    function stepAliens() {
        const alive = state.aliens.filter(a => a.alive);
        if (!alive.length) return;
        const minX = Math.min(...alive.map(a => a.x));
        const maxX = Math.max(...alive.map(a => a.x + a.w));
        const dx = 8 * state.alienDir;
        let drop = false;
        if (maxX + dx > W - 10 || minX + dx < 10) {
            drop = true;
            state.alienDir *= -1;
        }
        for (const a of state.aliens) {
            if (!a.alive) continue;
            if (drop) a.y += 14;
            else a.x += dx;
        }
    }

    function bottomMostAliens() {
        // Per column, find the lowest alive alien
        const cols = {};
        for (const a of state.aliens) {
            if (!a.alive) continue;
            const key = Math.round(a.x);
            if (!cols[key] || cols[key].y < a.y) cols[key] = a;
        }
        return Object.values(cols);
    }

    function rectHit(a, b) {
        return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
    }

    function killPlayer(forceGameOver = false) {
        state.lives -= 1;
        state.diedAt = performance.now();
        if (forceGameOver || state.lives <= 0) {
            gameOver();
        } else {
            resetPlayer();
            state.bullets = [];
            state.eBullets = [];
        }
        updateHud();
    }

    // ---------- Render ----------
    function render() {
        // backdrop
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, W, H);

        // baseline
        ctx.strokeStyle = GREEN_DIM;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, H - 30);
        ctx.lineTo(W, H - 30);
        ctx.stroke();

        // soft grid lines (very subtle)
        ctx.strokeStyle = 'rgba(0,255,102,0.05)';
        for (let i = 0; i < W; i += 40) {
            ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, H); ctx.stroke();
        }

        // aliens
        const sprite = state.animFrame ? ALIEN_B : ALIEN_A;
        for (const a of state.aliens) {
            if (!a.alive) continue;
            const color = a.row === 0 ? AMBER : a.row < 3 ? GREEN : '#69ff9b';
            drawSprite(sprite, a.x, a.y, color);
        }

        // player
        if (state.mode !== 'gameover') {
            const blink = state.mode === 'playing'
                ? true
                : (Math.floor(performance.now() / 120) % 2 === 0);
            if (blink) drawSprite(PLAYER_SPRITE, state.player.x, state.player.y, GREEN);
        }

        // bullets
        ctx.fillStyle = GREEN;
        ctx.shadowColor = GREEN;
        ctx.shadowBlur = 8;
        for (const b of state.bullets) ctx.fillRect(b.x, b.y, b.w, b.h);
        ctx.fillStyle = RED;
        ctx.shadowColor = RED;
        for (const b of state.eBullets) ctx.fillRect(b.x, b.y, b.w, b.h);
        ctx.shadowBlur = 0;
    }

    // ---------- Loop ----------
    function loop(t) {
        const dt = Math.min(0.05, (t - state.lastFrame) / 1000 || 0);
        state.lastFrame = t;
        update(dt);
        render();
        requestAnimationFrame(loop);
    }

    // ---------- Init ----------
    resetPlayer();
    spawnAliens(1);
    state.aliens.forEach(a => a.alive = false); // start screen: empty until SPACE
    updateHud();
    showOverlay('> INSERT_COIN', 'defend the terminal // press <span class="accent">SPACE</span> to start');
    requestAnimationFrame(loop);
})();
