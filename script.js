// Retro terminal portfolio — nav routing + clock + interactive shell

const navLinks = document.querySelectorAll('.nav-link');
const screens = document.querySelectorAll('.screen');
const titleSection = document.getElementById('title-section');

function activate(targetId) {
    if (!document.getElementById(targetId)) return;
    screens.forEach(s => s.classList.toggle('active', s.id === targetId));
    navLinks.forEach(l => l.classList.toggle('active', l.dataset.target === targetId));
    if (titleSection) titleSection.textContent = targetId;
    if (history.replaceState) history.replaceState(null, '', '#' + targetId);
}

// Mobile hamburger menu
const navToggle = document.getElementById('navToggle');
const navMenu = document.getElementById('navMenu');
function closeMenu() {
    if (!navMenu) return;
    navMenu.classList.remove('open');
    if (navToggle) { navToggle.classList.remove('open'); navToggle.setAttribute('aria-expanded', 'false'); }
}
if (navToggle && navMenu) {
    navToggle.addEventListener('click', () => {
        const open = navMenu.classList.toggle('open');
        navToggle.classList.toggle('open', open);
        navToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
}

document.querySelectorAll('[data-target]').forEach(el => {
    el.addEventListener('click', e => {
        const target = el.dataset.target;
        if (!target) return;
        e.preventDefault();
        activate(target);
        closeMenu();
    });
});

const initial = (location.hash || '#home').replace('#', '');
if (document.getElementById(initial)) activate(initial);

const keyMap = { '1': 'home', '2': 'about', '3': 'skills', '4': 'projects', '5': 'contact', '6': 'game', '7': 'wordle', '8': 'mips' };
document.addEventListener('keydown', e => {
    if (e.target.matches('input, textarea')) return;
    const target = keyMap[e.key];
    if (target) activate(target);
});

// Live clock
const clockEl = document.getElementById('clock');
function tick() {
    if (!clockEl) return;
    const d = new Date();
    const pad = n => String(n).padStart(2, '0');
    clockEl.textContent = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
tick();
setInterval(tick, 1000);

// Visitor's public IP + city. Tries multiple providers in order, since
// any single IP-geo endpoint may be down, rate-limited, or blocked by a
// privacy extension. Each call has a timeout so a hung request can't stall
// the chain. Falls back gracefully if all fail.
const ipEl = document.getElementById('ip');
const locEl = document.getElementById('loc');
if (ipEl || locEl) {
    const getJSON = async (url, ms = 4000) => {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), ms);
        try {
            const r = await fetch(url, { signal: ctrl.signal });
            if (!r.ok) throw new Error('HTTP ' + r.status);
            return await r.json();
        } finally {
            clearTimeout(t);
        }
    };

    const providers = [
        // GeoJS — reliable, CORS-friendly
        async () => {
            const d = await getJSON('https://get.geojs.io/v1/ip/geo.json');
            return { ip: d.ip, parts: [d.city, d.region, d.country_code] };
        },
        // ipwho.is
        async () => {
            const d = await getJSON('https://ipwho.is/');
            if (d.success === false) throw new Error('ipwho failed');
            return { ip: d.ip, parts: [d.city, d.region_code, d.country_code] };
        },
        // ipapi.co
        async () => {
            const d = await getJSON('https://ipapi.co/json/');
            if (d.error) throw new Error('ipapi failed');
            return { ip: d.ip, parts: [d.city, d.region_code, d.country_code] };
        },
    ];

    (async () => {
        for (const get of providers) {
            try {
                const { ip, parts } = await get();
                if (!ip) throw new Error('no ip');
                const loc = parts.filter(Boolean).join(', ');
                if (ipEl) ipEl.textContent = `IP: ${ip}`;
                if (locEl) locEl.textContent = loc ? `LOC: ${loc}` : 'LOC: unknown';
                return;
            } catch (_) { /* try next provider */ }
        }
        if (ipEl) ipEl.textContent = 'IP: unavailable';
        if (locEl) locEl.textContent = 'LOC: unknown';
    })();
}

/* ============================================================
   Virtual filesystem + shell
   ============================================================ */

const fs = {
    '~': {
        dirs: ['about', 'skills', 'projects', 'contact', 'game', 'wordle', 'mips'],
        files: ['resume.pdf', 'README.md']
    },
    '~/game': {
        dirs: [],
        files: ['invaders.exe', 'highscore.dat']
    },
    '~/wordle': {
        dirs: [],
        files: ['wordle.exe', 'wordlist.txt']
    },
    '~/mips': {
        dirs: [],
        files: ['mips_cpu', 'main.s', 'fibonacci.s', 'sum.s', 'factorial.s']
    },
    '~/about': {
        dirs: [],
        files: ['bio.txt', 'experience.txt', 'education.txt', 'location.txt']
    },
    '~/skills': {
        dirs: ['frontend', 'backend_cloud', 'hardware_systems'],
        files: []
    },
    '~/skills/frontend': {
        dirs: [],
        files: ['html', 'css', 'javascript', 'typescript', 'react', 'next.js', 'tailwind', 'figma']
    },
    '~/skills/backend_cloud': {
        dirs: [],
        files: ['c_cpp', 'python', 'java', 'node.js', 'express', 'sql', 'aws', 'docker', 'linux', 'bash', 'git']
    },
    '~/skills/hardware_systems': {
        dirs: [],
        files: ['systemverilog', 'pymtl3', 'verilator', 'vivado', 'arduino', 'openmpi', 'cython', 'flex_bison']
    },
    '~/projects': {
        dirs: [],
        files: [
            'guardian_state_recognizer',
            'cancer_predictor',
            'cgra_hw_security',
            'systemverilog_cpu',
            'parallel_hash_cracker',
            'custom_bash_shell',
            'wordle_clone',
            'spotify_karaoke',
            'arduino_rtc_led_sign'
        ]
    },
    '~/contact': {
        dirs: [],
        files: ['email.txt', 'linkedin.txt', 'github.txt']
    }
};

// Section-routing dirs (cd into one of these flips the active screen)
const SECTION_DIRS = new Set(['about', 'skills', 'projects', 'contact', 'home', 'game', 'wordle', 'mips']);

let cwd = '~';
const history_ = [];
let historyIdx = -1;

const out = document.getElementById('terminal-output');
const cwdDisplay = document.getElementById('cwd-display');
const input = document.getElementById('shell-input');
const form = document.getElementById('shell-form');
const shellRoot = document.getElementById('shell');

function setCwd(path) {
    cwd = path;
    if (cwdDisplay) cwdDisplay.textContent = path;
}

function print(html, cls = '') {
    const div = document.createElement('div');
    div.className = 'out-line ' + cls;
    div.innerHTML = html;
    out.appendChild(div);
    out.scrollTop = out.scrollHeight;
}

function escapeHtml(s) {
    return s
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function echoCommand(raw) {
    print(
        `<span class="prompt">root@izaak</span>:<span class="path">${cwd}</span>$ ${escapeHtml(raw)}`,
        'out-cmd'
    );
}

function resolvePath(arg) {
    // Handle ~, .., ., absolute-ish, and relative
    if (!arg || arg === '~' || arg === '/') return '~';
    if (arg === '.') return cwd;
    if (arg === '..') {
        if (cwd === '~') return '~';
        const idx = cwd.lastIndexOf('/');
        return idx === -1 ? '~' : cwd.slice(0, idx);
    }
    // strip trailing slash
    arg = arg.replace(/\/+$/, '');

    if (arg.startsWith('~/')) return arg;
    if (arg.startsWith('/')) return '~' + arg; // pretend root maps to home

    // multi-segment relative path: "skills/frontend"
    let next = cwd;
    for (const seg of arg.split('/')) {
        if (!seg || seg === '.') continue;
        if (seg === '..') {
            const idx = next.lastIndexOf('/');
            next = idx === -1 ? '~' : next.slice(0, idx);
            continue;
        }
        const node = fs[next];
        if (!node) return null;
        if (node.dirs.includes(seg)) {
            next = next + '/' + seg;
        } else if (node.files.includes(seg)) {
            // file — return the full path so caller can detect it's not a dir
            return next + '/' + seg + '@FILE';
        } else {
            return null;
        }
    }
    return next;
}

function listing(path) {
    const node = fs[path];
    if (!node) return null;
    const items = [];
    node.dirs.forEach(d => items.push({ name: d, type: 'dir' }));
    node.files.forEach(f => items.push({ name: f, type: 'file' }));
    return items;
}

/* === Commands === */

const commands = {
    help() {
        print('available commands:', 'out-info');
        print('  <span class="accent">ls</span> [path]        list directory contents');
        print('  <span class="accent">cd</span> &lt;path&gt;        change directory (cd .., cd ~, cd projects)');
        print('  <span class="accent">pwd</span>               print working directory');
        print('  <span class="accent">clear</span>             clear the screen');
        print('  <span class="accent">help</span>              show this list');
        print('tip: <span class="out-info">cd</span> into <span class="ls-dir">about</span> / <span class="ls-dir">skills</span> / <span class="ls-dir">projects</span> / <span class="ls-dir">contact</span> to switch screens.', 'out-info');
    },

    pwd() {
        // Show in /home/izaak form, with ~ expanded
        const expanded = cwd === '~' ? '/home/izaak' : '/home/izaak' + cwd.slice(1);
        print(expanded);
    },

    ls(args) {
        const target = args[0] ? resolvePath(args[0]) : cwd;
        if (target === null) {
            print(`ls: cannot access '${escapeHtml(args[0])}': No such file or directory`, 'out-err');
            return;
        }
        if (target.endsWith('@FILE')) {
            // ls of a single file just echoes its name
            const name = target.slice(0, -5).split('/').pop();
            print(`<span class="ls-file">${escapeHtml(name)}</span>`);
            return;
        }
        const items = listing(target);
        if (!items) {
            print(`ls: cannot access '${escapeHtml(args[0] || cwd)}': No such file or directory`, 'out-err');
            return;
        }
        if (items.length === 0) {
            print('<span class="out-info">(empty)</span>');
            return;
        }
        const html = items
            .map(it =>
                it.type === 'dir'
                    ? `<span class="ls-dir">${escapeHtml(it.name)}/</span>`
                    : `<span class="ls-file">${escapeHtml(it.name)}</span>`
            )
            .join('   ');
        print(html);
    },

    cd(args) {
        if (!args[0] || args[0] === '~' || args[0] === '/') {
            setCwd('~');
            activate('home');
            return;
        }
        const target = resolvePath(args[0]);
        if (target === null) {
            print(`cd: no such file or directory: ${escapeHtml(args[0])}`, 'out-err');
            return;
        }
        if (target.endsWith('@FILE')) {
            print(`cd: not a directory: ${escapeHtml(args[0])}`, 'out-err');
            return;
        }
        setCwd(target);

        // If we landed at a section root, route the page
        // ~ -> home; ~/about -> about; ~/projects -> projects; etc.
        if (target === '~') {
            activate('home');
        } else {
            const seg = target.split('/')[1]; // "about", "skills", etc.
            if (SECTION_DIRS.has(seg)) activate(seg);
        }
    },

    clear() {
        out.innerHTML = '';
    }
};

function runCommand(raw) {
    const trimmed = raw.trim();
    echoCommand(raw);
    if (!trimmed) return;
    const [name, ...args] = trimmed.split(/\s+/);
    const cmd = commands[name];
    if (cmd) {
        cmd(args);
    } else {
        print(`${escapeHtml(name)}: command not found`, 'out-err');
    }
}

/* === Input wiring === */

if (form && input) {
    form.addEventListener('submit', e => {
        e.preventDefault();
        const value = input.value;
        runCommand(value);
        if (value.trim()) {
            history_.push(value);
            historyIdx = history_.length;
        }
        input.value = '';
    });

    input.addEventListener('keydown', e => {
        if (e.key === 'ArrowUp') {
            if (history_.length === 0) return;
            e.preventDefault();
            historyIdx = Math.max(0, historyIdx - 1);
            input.value = history_[historyIdx] || '';
            requestAnimationFrame(() => input.setSelectionRange(input.value.length, input.value.length));
        } else if (e.key === 'ArrowDown') {
            if (history_.length === 0) return;
            e.preventDefault();
            historyIdx = Math.min(history_.length, historyIdx + 1);
            input.value = history_[historyIdx] || '';
        } else if (e.key === 'l' && e.ctrlKey) {
            e.preventDefault();
            commands.clear();
        }
    });

    // Click anywhere in the shell to focus the input
    if (shellRoot) {
        shellRoot.addEventListener('click', () => input.focus());
    }

    // Auto-focus when the home screen is active
    const homeScreen = document.getElementById('home');
    const focusInput = () => {
        if (homeScreen.classList.contains('active')) input.focus();
    };
    focusInput();
    new MutationObserver(focusInput).observe(homeScreen, { attributes: true, attributeFilter: ['class'] });

    // Friendly first message
    print('izaak.sh v1.0 — type <span class="accent">help</span> to begin.', 'out-info');
}
