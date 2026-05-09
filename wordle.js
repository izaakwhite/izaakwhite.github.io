// Wordle — terminal port. Uses window.WORDLIST loaded from assets/wordlist.js

(function () {
    const board = document.getElementById('wordle-board');
    const keyboard = document.getElementById('wordle-keyboard');
    const status = document.getElementById('wordle-status');
    const resetBtn = document.getElementById('wordle-reset');
    const screen = document.getElementById('wordle');
    if (!board || !keyboard || !screen) return;

    const ROWS = 6;
    const COLS = 5;

    const WORDS = (window.WORDLIST || []).filter(w => w && w.length === COLS).map(w => w.toLowerCase());
    const VALID = new Set(WORDS);

    const state = {
        target: '',
        guesses: [],   // array of strings
        current: '',
        row: 0,
        done: false,
        keyState: {}   // letter -> 'correct' | 'present' | 'absent'
    };

    // ---------- Build DOM ----------
    function buildBoard() {
        board.innerHTML = '';
        for (let r = 0; r < ROWS; r++) {
            const row = document.createElement('div');
            row.className = 'wordle-row';
            row.dataset.row = r;
            for (let c = 0; c < COLS; c++) {
                const tile = document.createElement('div');
                tile.className = 'wordle-tile';
                tile.dataset.row = r;
                tile.dataset.col = c;
                row.appendChild(tile);
            }
            board.appendChild(row);
        }
    }

    const KB_LAYOUT = [
        ['q','w','e','r','t','y','u','i','o','p'],
        ['a','s','d','f','g','h','j','k','l'],
        ['ENTER','z','x','c','v','b','n','m','BACK']
    ];
    function buildKeyboard() {
        keyboard.innerHTML = '';
        for (const row of KB_LAYOUT) {
            const r = document.createElement('div');
            r.className = 'kb-row';
            for (const k of row) {
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'kb-key' + (k.length > 1 ? ' wide' : '');
                btn.textContent = k === 'BACK' ? '⌫' : k.toUpperCase();
                btn.dataset.key = k;
                btn.addEventListener('click', () => handleKey(k));
                r.appendChild(btn);
            }
            keyboard.appendChild(r);
        }
    }

    function tile(r, c) {
        return board.querySelector(`[data-row="${r}"][data-col="${c}"]`);
    }

    // ---------- Game ----------
    function pickWord() {
        if (!WORDS.length) return 'crane';
        return WORDS[Math.floor(Math.random() * WORDS.length)];
    }

    function newGame() {
        state.target = pickWord();
        state.guesses = [];
        state.current = '';
        state.row = 0;
        state.done = false;
        state.keyState = {};
        buildBoard();
        // Reset keyboard colors
        keyboard.querySelectorAll('.kb-key').forEach(k => {
            k.classList.remove('correct', 'present', 'absent');
        });
        setStatus(`new word loaded // ${WORDS.length.toLocaleString()} words in dictionary`);
    }

    function setStatus(msg, kind = 'info') {
        status.textContent = msg;
        status.style.color =
            kind === 'win' ? 'var(--green)' :
            kind === 'lose' ? 'var(--red)' :
            kind === 'warn' ? 'var(--amber)' :
            'var(--text)';
        if (kind === 'win' || kind === 'lose') {
            status.style.textShadow = '0 0 6px ' + (kind === 'win' ? 'var(--green-glow)' : 'rgba(255,48,48,0.6)');
        } else {
            status.style.textShadow = '';
        }
    }

    function handleKey(k) {
        if (state.done) return;
        if (k === 'ENTER') return submitGuess();
        if (k === 'BACK' || k === 'BACKSPACE') return backspace();
        if (/^[a-z]$/i.test(k) && state.current.length < COLS) {
            state.current += k.toLowerCase();
            renderCurrent();
        }
    }

    function backspace() {
        if (!state.current.length) return;
        state.current = state.current.slice(0, -1);
        renderCurrent();
    }

    function renderCurrent() {
        for (let c = 0; c < COLS; c++) {
            const t = tile(state.row, c);
            const ch = state.current[c] || '';
            t.textContent = ch;
            t.classList.toggle('filled', !!ch);
        }
    }

    function submitGuess() {
        if (state.current.length < COLS) {
            shakeRow();
            setStatus('not enough letters', 'warn');
            return;
        }
        const guess = state.current;
        if (!VALID.has(guess)) {
            shakeRow();
            setStatus(`"${guess}" not in dictionary`, 'warn');
            return;
        }

        const result = scoreGuess(guess, state.target);
        animateRow(state.row, guess, result);

        // Update keyboard state with priority correct > present > absent
        for (let i = 0; i < COLS; i++) {
            const ch = guess[i];
            const cur = state.keyState[ch];
            const next = result[i];
            if (cur === 'correct') continue;
            if (cur === 'present' && next === 'absent') continue;
            state.keyState[ch] = next;
        }
        // Defer keyboard color update to after flip animation
        setTimeout(applyKeyColors, COLS * 110 + 250);

        state.guesses.push(guess);
        state.row += 1;
        state.current = '';

        if (guess === state.target) {
            state.done = true;
            setTimeout(() => setStatus(`solved in ${state.guesses.length}/${ROWS} // press ./new_word for another`, 'win'), COLS * 110 + 200);
        } else if (state.row >= ROWS) {
            state.done = true;
            setTimeout(() => setStatus(`out of guesses // word was "${state.target.toUpperCase()}"`, 'lose'), COLS * 110 + 200);
        } else {
            setTimeout(() => setStatus('guess again'), COLS * 110 + 200);
        }
    }

    function scoreGuess(guess, target) {
        const result = Array(COLS).fill('absent');
        const counts = {};
        for (const ch of target) counts[ch] = (counts[ch] || 0) + 1;
        // First pass: correct
        for (let i = 0; i < COLS; i++) {
            if (guess[i] === target[i]) {
                result[i] = 'correct';
                counts[guess[i]] -= 1;
            }
        }
        // Second pass: present
        for (let i = 0; i < COLS; i++) {
            if (result[i] === 'correct') continue;
            const ch = guess[i];
            if (counts[ch] > 0) {
                result[i] = 'present';
                counts[ch] -= 1;
            }
        }
        return result;
    }

    function animateRow(r, guess, result) {
        for (let c = 0; c < COLS; c++) {
            const t = tile(r, c);
            const cls = result[c];
            // stagger flip animation
            setTimeout(() => {
                t.classList.add('flip');
                setTimeout(() => {
                    t.textContent = guess[c];
                    t.classList.remove('filled');
                    t.classList.add(cls);
                }, 250);
                setTimeout(() => t.classList.remove('flip'), 500);
            }, c * 110);
        }
    }

    function shakeRow() {
        const tiles = board.querySelectorAll(`[data-row="${state.row}"]`);
        tiles.forEach(t => {
            t.classList.remove('shake');
            // force reflow to restart animation
            void t.offsetWidth;
            t.classList.add('shake');
        });
    }

    function applyKeyColors() {
        keyboard.querySelectorAll('.kb-key').forEach(btn => {
            const k = btn.dataset.key;
            if (k.length > 1) return;
            const s = state.keyState[k];
            btn.classList.remove('correct', 'present', 'absent');
            if (s) btn.classList.add(s);
        });
    }

    // ---------- Input ----------
    document.addEventListener('keydown', e => {
        if (!screen.classList.contains('active')) return;
        if (e.target.matches('input, textarea')) return;
        if (e.key === 'Enter') { e.preventDefault(); handleKey('ENTER'); return; }
        if (e.key === 'Backspace') { e.preventDefault(); handleKey('BACK'); return; }
        if (/^[a-zA-Z]$/.test(e.key)) { handleKey(e.key.toLowerCase()); }
    });

    if (resetBtn) resetBtn.addEventListener('click', newGame);

    // ---------- Init ----------
    buildBoard();
    buildKeyboard();
    if (!WORDS.length) {
        setStatus('error: wordlist failed to load', 'lose');
    } else {
        newGame();
    }
})();
