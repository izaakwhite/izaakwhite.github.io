// Minimal MIPS-32 simulator + assembler
// Supports a useful subset: arithmetic, logic, shifts, mul/div, branches,
// jumps, loads/stores, lui, syscalls (1, 4, 10, 11), and common pseudo-ops.

(function () {
    const $ = id => document.getElementById(id);
    const sourceEl = $('mips-source');
    if (!sourceEl) return;

    /* ============================================================
       Constants
       ============================================================ */

    const TEXT_BASE = 0x00400000;
    const DATA_BASE = 0x10010000;
    const SP_INIT   = 0x7fffeffc;
    const MAX_STEPS = 1_000_000;

    const REG_NAMES = [
        'zero','at','v0','v1','a0','a1','a2','a3',
        't0','t1','t2','t3','t4','t5','t6','t7',
        's0','s1','s2','s3','s4','s5','s6','s7',
        't8','t9','k0','k1','gp','sp','fp','ra'
    ];
    const REG_INDEX = {};
    REG_NAMES.forEach((n, i) => { REG_INDEX['$' + n] = i; });
    for (let i = 0; i < 32; i++) REG_INDEX['$' + i] = i;
    REG_INDEX['$0'] = 0;

    function regNum(tok) {
        const r = REG_INDEX[tok];
        if (r === undefined) throw new Error(`unknown register: ${tok}`);
        return r;
    }

    /* ============================================================
       CPU
       ============================================================ */

    class CPU {
        constructor() { this.reset(); }

        reset() {
            this.regs = new Int32Array(32);
            this.regs[REG_INDEX.$sp] = SP_INIT | 0;
            this.regs[REG_INDEX.$gp] = 0x10008000 | 0;
            this.pc = TEXT_BASE;
            this.hi = 0; this.lo = 0;
            this.mem = new Map();   // byte addr -> byte
            this.instrs = new Map(); // pc -> decoded ins
            this.labels = {};
            this.dataEnd = DATA_BASE;
            this.halted = false;
            this.output = '';
            this.steps = 0;
        }

        loadByte(addr) { return this.mem.get(addr >>> 0) | 0; }
        storeByte(addr, v) { this.mem.set(addr >>> 0, v & 0xff); }
        loadWord(addr) {
            return ((this.loadByte(addr + 3) << 24) |
                    (this.loadByte(addr + 2) << 16) |
                    (this.loadByte(addr + 1) << 8)  |
                    (this.loadByte(addr))) | 0;
        }
        storeWord(addr, v) {
            this.storeByte(addr,     v);
            this.storeByte(addr + 1, v >> 8);
            this.storeByte(addr + 2, v >> 16);
            this.storeByte(addr + 3, v >> 24);
        }

        write(rd, val) {
            if (rd !== 0) this.regs[rd] = val | 0;
        }

        readString(addr) {
            let s = '';
            let a = addr >>> 0;
            for (let i = 0; i < 4096; i++) {
                const b = this.loadByte(a + i);
                if (b === 0) break;
                s += String.fromCharCode(b);
            }
            return s;
        }

        step() {
            if (this.halted) return false;
            const ins = this.instrs.get(this.pc >>> 0);
            if (!ins) {
                this.halted = true;
                throw new Error(`no instruction at PC = 0x${(this.pc >>> 0).toString(16).padStart(8, '0')}`);
            }
            this.pc = (this.pc + 4) | 0;
            this.execute(ins);
            this.steps++;
            return !this.halted;
        }

        execute(ins) {
            const r = this.regs;
            switch (ins.op) {
                case 'add': case 'addu': this.write(ins.rd, r[ins.rs] + r[ins.rt]); break;
                case 'sub': case 'subu': this.write(ins.rd, r[ins.rs] - r[ins.rt]); break;
                case 'and': this.write(ins.rd, r[ins.rs] & r[ins.rt]); break;
                case 'or':  this.write(ins.rd, r[ins.rs] | r[ins.rt]); break;
                case 'xor': this.write(ins.rd, r[ins.rs] ^ r[ins.rt]); break;
                case 'nor': this.write(ins.rd, ~(r[ins.rs] | r[ins.rt])); break;
                case 'slt':  this.write(ins.rd, r[ins.rs] < r[ins.rt] ? 1 : 0); break;
                case 'sltu': this.write(ins.rd, ((r[ins.rs] >>> 0) < (r[ins.rt] >>> 0)) ? 1 : 0); break;
                case 'sll': this.write(ins.rd, r[ins.rt] << ins.shamt); break;
                case 'srl': this.write(ins.rd, r[ins.rt] >>> ins.shamt); break;
                case 'sra': this.write(ins.rd, r[ins.rt] >> ins.shamt); break;
                case 'sllv': this.write(ins.rd, r[ins.rt] << (r[ins.rs] & 0x1f)); break;
                case 'srlv': this.write(ins.rd, r[ins.rt] >>> (r[ins.rs] & 0x1f)); break;
                case 'srav': this.write(ins.rd, r[ins.rt] >> (r[ins.rs] & 0x1f)); break;

                case 'mult': case 'multu': {
                    const p = BigInt(r[ins.rs]) * BigInt(r[ins.rt]);
                    this.lo = Number(BigInt.asIntN(32, p)) | 0;
                    this.hi = Number(BigInt.asIntN(32, p >> 32n)) | 0;
                    break;
                }
                case 'div': case 'divu': {
                    if (r[ins.rt] !== 0) {
                        this.lo = (r[ins.rs] / r[ins.rt]) | 0;
                        this.hi = (r[ins.rs] % r[ins.rt]) | 0;
                    }
                    break;
                }
                case 'mfhi': this.write(ins.rd, this.hi); break;
                case 'mflo': this.write(ins.rd, this.lo); break;
                case 'mthi': this.hi = r[ins.rs]; break;
                case 'mtlo': this.lo = r[ins.rs]; break;

                case 'jr':   this.pc = r[ins.rs]; break;
                case 'jalr': this.write(ins.rd || 31, this.pc); this.pc = r[ins.rs]; break;

                case 'addi': case 'addiu': this.write(ins.rt, r[ins.rs] + ins.imm); break;
                case 'andi': this.write(ins.rt, r[ins.rs] & (ins.imm & 0xffff)); break;
                case 'ori':  this.write(ins.rt, r[ins.rs] | (ins.imm & 0xffff)); break;
                case 'xori': this.write(ins.rt, r[ins.rs] ^ (ins.imm & 0xffff)); break;
                case 'slti': this.write(ins.rt, r[ins.rs] < ins.imm ? 1 : 0); break;
                case 'sltiu': this.write(ins.rt, (r[ins.rs] >>> 0) < (ins.imm >>> 0) ? 1 : 0); break;
                case 'lui':  this.write(ins.rt, (ins.imm & 0xffff) << 16); break;

                case 'lw':  this.write(ins.rt, this.loadWord(r[ins.rs] + ins.imm)); break;
                case 'sw':  this.storeWord(r[ins.rs] + ins.imm, r[ins.rt]); break;
                case 'lb':  { const v = this.loadByte(r[ins.rs] + ins.imm); this.write(ins.rt, (v << 24) >> 24); break; }
                case 'lbu': this.write(ins.rt, this.loadByte(r[ins.rs] + ins.imm) & 0xff); break;
                case 'lh':  {
                    const a = r[ins.rs] + ins.imm;
                    const v = (this.loadByte(a + 1) << 8) | this.loadByte(a);
                    this.write(ins.rt, (v << 16) >> 16);
                    break;
                }
                case 'lhu': {
                    const a = r[ins.rs] + ins.imm;
                    this.write(ins.rt, ((this.loadByte(a + 1) << 8) | this.loadByte(a)) & 0xffff);
                    break;
                }
                case 'sb': this.storeByte(r[ins.rs] + ins.imm, r[ins.rt]); break;
                case 'sh': {
                    const a = r[ins.rs] + ins.imm;
                    this.storeByte(a, r[ins.rt]);
                    this.storeByte(a + 1, r[ins.rt] >> 8);
                    break;
                }

                case 'beq':  if (r[ins.rs] === r[ins.rt]) this.pc = ins.target; break;
                case 'bne':  if (r[ins.rs] !== r[ins.rt]) this.pc = ins.target; break;
                case 'bgtz': if (r[ins.rs] > 0)  this.pc = ins.target; break;
                case 'bltz': if (r[ins.rs] < 0)  this.pc = ins.target; break;
                case 'bgez': if (r[ins.rs] >= 0) this.pc = ins.target; break;
                case 'blez': if (r[ins.rs] <= 0) this.pc = ins.target; break;
                case 'j':    this.pc = ins.target; break;
                case 'jal':  this.regs[31] = this.pc; this.pc = ins.target; break;

                case 'syscall': this.syscall(); break;
                case 'nop': break;

                default:
                    this.halted = true;
                    throw new Error(`unimplemented instruction: ${ins.op}`);
            }
        }

        syscall() {
            const v0 = this.regs[REG_INDEX.$v0];
            const a0 = this.regs[REG_INDEX.$a0];
            switch (v0) {
                case 1: this.output += String(a0); break;          // print int
                case 4: this.output += this.readString(a0); break;  // print string
                case 10: this.halted = true; break;                 // exit
                case 11: this.output += String.fromCharCode(a0 & 0xff); break; // print char
                case 17: this.halted = true; break;                 // exit2
                default:
                    this.halted = true;
                    throw new Error(`unsupported syscall code: ${v0}`);
            }
        }
    }

    /* ============================================================
       Assembler
       ============================================================ */

    function tokenize(line) {
        // strip strings preserving them as a single token
        const tokens = [];
        let i = 0;
        while (i < line.length) {
            const c = line[i];
            if (c === ' ' || c === '\t' || c === ',') { i++; continue; }
            if (c === '"') {
                let j = i + 1;
                let s = '"';
                while (j < line.length && line[j] !== '"') {
                    if (line[j] === '\\' && j + 1 < line.length) { s += line[j] + line[j + 1]; j += 2; }
                    else { s += line[j]; j++; }
                }
                s += '"';
                tokens.push(s);
                i = j + 1;
                continue;
            }
            // read until whitespace, comma, or paren
            let t = '';
            while (i < line.length && !' \t,'.includes(line[i])) {
                t += line[i]; i++;
            }
            tokens.push(t);
        }
        return tokens;
    }

    function parseImm(tok, labels) {
        if (tok === undefined) throw new Error('missing immediate');
        if (labels && tok in labels) return labels[tok];
        if (/^-?0x[0-9a-f]+$/i.test(tok)) return parseInt(tok, 16) | 0;
        if (/^-?\d+$/.test(tok)) return parseInt(tok, 10) | 0;
        if (/^'(.|\\.)'$/.test(tok)) {
            const inner = tok.slice(1, -1);
            const ch = inner.length === 2 && inner[0] === '\\'
                ? ({ n: '\n', t: '\t', r: '\r', '0': '\0', '\\': '\\', "'": "'", '"': '"' })[inner[1]] || inner[1]
                : inner;
            return ch.charCodeAt(0);
        }
        throw new Error(`bad immediate: ${tok}`);
    }

    function parseMemOperand(tok) {
        // forms: imm($reg), $reg, imm
        const m = tok.match(/^(-?\w+)?\(\s*(\$\w+)\s*\)$/);
        if (m) return { off: m[1] ? parseImm(m[1]) : 0, base: regNum(m[2]) };
        if (tok.startsWith('$')) return { off: 0, base: regNum(tok) };
        return { off: parseImm(tok), base: 0 };
    }

    // Ops that fall directly through assembler
    const NATIVE_OPS = new Set([
        'add','addu','sub','subu','and','or','xor','nor',
        'slt','sltu','sll','srl','sra','sllv','srlv','srav',
        'mult','multu','div','divu','mfhi','mflo','mthi','mtlo',
        'jr','jalr',
        'addi','addiu','andi','ori','xori','slti','sltiu','lui',
        'lw','sw','lb','lbu','lh','lhu','sb','sh',
        'beq','bne','bgtz','bltz','bgez','blez',
        'j','jal','syscall','nop'
    ]);

    // Pseudo expansion (instruction count). Used by pass 1 for sizing.
    function pseudoSize(op, args) {
        switch (op) {
            case 'li': {
                const v = parseImm(args[1]) | 0;
                return (v >= -32768 && v <= 65535) ? 1 : 2;
            }
            case 'la': return 2;
            case 'move': return 1;
            case 'b': return 1;
            case 'beqz': case 'bnez': return 1;
            case 'bgt': case 'blt': case 'bge': case 'ble': return 2;
            case 'mul': return 2; // mult + mflo
            case 'neg': case 'negu': return 1;
            case 'not': return 1;
            case 'nop': return 1;
            default: return 1;
        }
    }

    // Expand pseudo to one or more decoded instructions
    function expand(op, args, labels) {
        switch (op) {
            case 'li': {
                const rt = regNum(args[0]);
                const v = parseImm(args[1], labels) | 0;
                if (v >= -32768 && v <= 32767) {
                    return [{ op: 'addiu', rs: 0, rt, imm: v }];
                }
                if (v >= 0 && v <= 0xffff) {
                    return [{ op: 'ori', rs: 0, rt, imm: v }];
                }
                const hi = (v >>> 16) & 0xffff;
                const lo = v & 0xffff;
                return [
                    { op: 'lui', rs: 0, rt, imm: hi },
                    { op: 'ori', rs: rt, rt, imm: lo }
                ];
            }
            case 'la': {
                const rt = regNum(args[0]);
                const v = parseImm(args[1], labels) | 0;
                const hi = (v >>> 16) & 0xffff;
                const lo = v & 0xffff;
                return [
                    { op: 'lui', rs: 0, rt, imm: hi },
                    { op: 'ori', rs: rt, rt, imm: lo }
                ];
            }
            case 'move':
                return [{ op: 'addu', rs: regNum(args[1]), rt: 0, rd: regNum(args[0]) }];
            case 'nop':
                return [{ op: 'nop' }];
            case 'b':
                return [{ op: 'j', target: parseImm(args[0], labels) }];
            case 'beqz':
                return [{ op: 'beq', rs: regNum(args[0]), rt: 0, target: parseImm(args[1], labels) }];
            case 'bnez':
                return [{ op: 'bne', rs: regNum(args[0]), rt: 0, target: parseImm(args[1], labels) }];
            case 'bgt': {
                // slt $at, $b, $a; bne $at, $zero, target  =>  if a > b
                const a = regNum(args[0]), b = regNum(args[1]);
                return [
                    { op: 'slt', rs: b, rt: a, rd: 1 },
                    { op: 'bne', rs: 1, rt: 0, target: parseImm(args[2], labels) }
                ];
            }
            case 'blt': {
                const a = regNum(args[0]), b = regNum(args[1]);
                return [
                    { op: 'slt', rs: a, rt: b, rd: 1 },
                    { op: 'bne', rs: 1, rt: 0, target: parseImm(args[2], labels) }
                ];
            }
            case 'bge': {
                const a = regNum(args[0]), b = regNum(args[1]);
                return [
                    { op: 'slt', rs: a, rt: b, rd: 1 },
                    { op: 'beq', rs: 1, rt: 0, target: parseImm(args[2], labels) }
                ];
            }
            case 'ble': {
                const a = regNum(args[0]), b = regNum(args[1]);
                return [
                    { op: 'slt', rs: b, rt: a, rd: 1 },
                    { op: 'beq', rs: 1, rt: 0, target: parseImm(args[2], labels) }
                ];
            }
            case 'mul': {
                return [
                    { op: 'mult', rs: regNum(args[1]), rt: regNum(args[2]) },
                    { op: 'mflo', rd: regNum(args[0]) }
                ];
            }
            case 'neg': case 'negu':
                return [{ op: 'subu', rs: 0, rt: regNum(args[1]), rd: regNum(args[0]) }];
            case 'not':
                return [{ op: 'nor', rs: regNum(args[1]), rt: 0, rd: regNum(args[0]) }];
        }
        return null;
    }

    function decodeNative(op, args, labels) {
        const im = (s) => parseImm(s, labels);
        switch (op) {
            case 'add': case 'addu': case 'sub': case 'subu':
            case 'and': case 'or': case 'xor': case 'nor':
            case 'slt': case 'sltu':
                return { op, rd: regNum(args[0]), rs: regNum(args[1]), rt: regNum(args[2]) };
            case 'sll': case 'srl': case 'sra':
                return { op, rd: regNum(args[0]), rt: regNum(args[1]), shamt: im(args[2]) & 0x1f };
            case 'sllv': case 'srlv': case 'srav':
                return { op, rd: regNum(args[0]), rt: regNum(args[1]), rs: regNum(args[2]) };
            case 'mult': case 'multu': case 'div': case 'divu':
                return { op, rs: regNum(args[0]), rt: regNum(args[1]) };
            case 'mfhi': case 'mflo':
                return { op, rd: regNum(args[0]) };
            case 'mthi': case 'mtlo':
                return { op, rs: regNum(args[0]) };
            case 'jr':
                return { op, rs: regNum(args[0]) };
            case 'jalr':
                if (args.length === 1) return { op, rd: 31, rs: regNum(args[0]) };
                return { op, rd: regNum(args[0]), rs: regNum(args[1]) };
            case 'addi': case 'addiu': case 'andi': case 'ori': case 'xori':
            case 'slti': case 'sltiu':
                return { op, rt: regNum(args[0]), rs: regNum(args[1]), imm: im(args[2]) };
            case 'lui':
                return { op, rt: regNum(args[0]), rs: 0, imm: im(args[1]) & 0xffff };
            case 'lw': case 'sw': case 'lb': case 'lbu': case 'lh': case 'lhu':
            case 'sb': case 'sh': {
                const m = parseMemOperand(args[1]);
                return { op, rt: regNum(args[0]), rs: m.base, imm: m.off };
            }
            case 'beq': case 'bne':
                return { op, rs: regNum(args[0]), rt: regNum(args[1]), target: im(args[2]) };
            case 'bgtz': case 'bltz': case 'bgez': case 'blez':
                return { op, rs: regNum(args[0]), rt: 0, target: im(args[1]) };
            case 'j': case 'jal':
                return { op, target: im(args[0]) };
            case 'syscall': case 'nop':
                return { op };
        }
        throw new Error(`unknown op: ${op}`);
    }

    function assemble(source, cpu) {
        cpu.reset();
        const lines = source.split('\n');
        const labels = {};
        let section = 'text';
        let textPC = TEXT_BASE;
        let dataPC = DATA_BASE;
        const stmts = []; // {pc, op, args, lineNo}

        // ---- Pass 1: collect labels, emit data, size text ----
        for (let lineNo = 0; lineNo < lines.length; lineNo++) {
            let line = lines[lineNo];
            const hashIdx = (() => {
                let inStr = false;
                for (let i = 0; i < line.length; i++) {
                    if (line[i] === '"') inStr = !inStr;
                    else if (line[i] === '#' && !inStr) return i;
                }
                return -1;
            })();
            if (hashIdx >= 0) line = line.slice(0, hashIdx);
            line = line.trim();
            if (!line) continue;

            // Labels can appear before a directive/instruction on the same line
            while (true) {
                const m = line.match(/^([A-Za-z_][\w]*)\s*:\s*(.*)$/);
                if (!m) break;
                labels[m[1]] = (section === 'text') ? textPC : dataPC;
                line = m[2].trim();
                if (!line) break;
            }
            if (!line) continue;

            if (line.startsWith('.')) {
                // directive
                const tokens = tokenize(line);
                const dir = tokens[0];
                const args = tokens.slice(1);
                if (dir === '.text') section = 'text';
                else if (dir === '.data') section = 'data';
                else if (dir === '.word') {
                    for (const a of args) {
                        const v = parseImm(a) | 0;
                        cpu.storeWord(dataPC, v);
                        dataPC += 4;
                    }
                } else if (dir === '.half') {
                    for (const a of args) {
                        const v = parseImm(a) & 0xffff;
                        cpu.storeByte(dataPC, v);
                        cpu.storeByte(dataPC + 1, v >> 8);
                        dataPC += 2;
                    }
                } else if (dir === '.byte') {
                    for (const a of args) {
                        cpu.storeByte(dataPC, parseImm(a) & 0xff);
                        dataPC += 1;
                    }
                } else if (dir === '.asciiz' || dir === '.ascii') {
                    const raw = args.join(' ');
                    const m = raw.match(/^"((?:[^"\\]|\\.)*)"$/);
                    if (!m) throw new Error(`line ${lineNo + 1}: bad string literal`);
                    const decoded = m[1].replace(/\\(.)/g, (_, c) =>
                        ({ n: '\n', t: '\t', r: '\r', '0': '\0', '\\': '\\', '"': '"' })[c] || c);
                    for (const ch of decoded) {
                        cpu.storeByte(dataPC, ch.charCodeAt(0));
                        dataPC++;
                    }
                    if (dir === '.asciiz') { cpu.storeByte(dataPC, 0); dataPC++; }
                } else if (dir === '.space') {
                    dataPC += parseImm(args[0]);
                } else if (dir === '.align') {
                    const a = parseImm(args[0]);
                    const align = 1 << a;
                    while (dataPC & (align - 1)) dataPC++;
                } else if (dir === '.globl' || dir === '.global') {
                    // ignored
                } else {
                    throw new Error(`line ${lineNo + 1}: unknown directive ${dir}`);
                }
                continue;
            }

            // text instruction
            const tokens = tokenize(line);
            const op = tokens[0].toLowerCase();
            const args = tokens.slice(1);
            const size = NATIVE_OPS.has(op) ? 1 : pseudoSize(op, args);
            stmts.push({ pc: textPC, op, args, lineNo });
            textPC += size * 4;
        }

        // ---- Pass 2: encode instructions ----
        for (const stmt of stmts) {
            try {
                let decoded;
                if (NATIVE_OPS.has(stmt.op)) {
                    decoded = [decodeNative(stmt.op, stmt.args, labels)];
                } else {
                    decoded = expand(stmt.op, stmt.args, labels);
                    if (!decoded) throw new Error(`unknown instruction: ${stmt.op}`);
                }
                let pc = stmt.pc;
                for (const ins of decoded) {
                    cpu.instrs.set(pc >>> 0, ins);
                    pc += 4;
                }
            } catch (e) {
                throw new Error(`line ${stmt.lineNo + 1}: ${e.message}`);
            }
        }

        cpu.labels = labels;
        cpu.dataEnd = dataPC;
        cpu.pc = labels.main !== undefined ? labels.main : TEXT_BASE;
    }

    /* ============================================================
       Sample programs
       ============================================================ */

    const SAMPLES = {
        'hello.s': `# Hello, world
        .data
msg:    .asciiz "hello, terminal!\\n"

        .text
main:   li   $v0, 4
        la   $a0, msg
        syscall

        li   $v0, 10
        syscall
`,
        'sum.s': `# Sum 1..N
        .data
prompt: .asciiz "sum 1.."
eq:     .asciiz " = "
nl:     .asciiz "\\n"

        .text
main:   li   $t0, 100          # N
        li   $t1, 0             # sum
        li   $t2, 1             # i
loop:   bgt  $t2, $t0, done
        add  $t1, $t1, $t2
        addi $t2, $t2, 1
        j    loop
done:   li   $v0, 4
        la   $a0, prompt
        syscall
        li   $v0, 1
        move $a0, $t0
        syscall
        li   $v0, 4
        la   $a0, eq
        syscall
        li   $v0, 1
        move $a0, $t1
        syscall
        li   $v0, 4
        la   $a0, nl
        syscall
        li   $v0, 10
        syscall
`,
        'factorial.s': `# Factorial via recursion
        .data
nlbl:   .asciiz "n = "
fmsg:   .asciiz ", n! = "
nl:     .asciiz "\\n"

        .text
main:   li   $a0, 7
        jal  fact
        move $s0, $v0          # save n!

        li   $v0, 4
        la   $a0, nlbl
        syscall
        li   $v0, 1
        li   $a0, 7
        syscall
        li   $v0, 4
        la   $a0, fmsg
        syscall
        li   $v0, 1
        move $a0, $s0
        syscall
        li   $v0, 4
        la   $a0, nl
        syscall
        li   $v0, 10
        syscall

# int fact(int n) — recursive, classic stack-frame style
fact:   addi $sp, $sp, -8
        sw   $ra, 4($sp)
        sw   $a0, 0($sp)
        li   $t0, 1
        ble  $a0, $t0, base
        addi $a0, $a0, -1
        jal  fact
        lw   $a0, 0($sp)
        mul  $v0, $v0, $a0
        j    fend
base:   li   $v0, 1
fend:   lw   $ra, 4($sp)
        addi $sp, $sp, 8
        jr   $ra
`,
        'fibonacci.s': `# First N Fibonacci numbers
        .data
sep:    .asciiz " "
nl:     .asciiz "\\n"

        .text
main:   li   $t0, 10           # how many
        li   $t1, 0             # a
        li   $t2, 1             # b
        li   $t3, 0             # i
loop:   bge  $t3, $t0, done
        li   $v0, 1
        move $a0, $t1
        syscall
        li   $v0, 4
        la   $a0, sep
        syscall
        add  $t4, $t1, $t2
        move $t1, $t2
        move $t2, $t4
        addi $t3, $t3, 1
        j    loop
done:   li   $v0, 4
        la   $a0, nl
        syscall
        li   $v0, 10
        syscall
`
    };

    /* ============================================================
       UI wiring
       ============================================================ */

    const cpu = new CPU();
    let prevRegs = new Int32Array(32);

    const regsEl = $('mips-regs');
    const consoleEl = $('mips-console');
    const memoryEl = $('mips-memory');
    const pcEl = $('mips-pc');
    const statusEl = $('mips-status');
    const sampleSel = $('mips-sample');

    function buildSampleSelect() {
        for (const name of Object.keys(SAMPLES)) {
            const opt = document.createElement('option');
            opt.value = name;
            opt.textContent = '> ' + name;
            sampleSel.appendChild(opt);
        }
        sampleSel.addEventListener('change', () => {
            sourceEl.value = SAMPLES[sampleSel.value];
        });
    }

    function buildRegs() {
        regsEl.innerHTML = '';
        for (let i = 0; i < 32; i++) {
            const row = document.createElement('div');
            row.className = 'reg-row';
            row.dataset.reg = i;
            row.innerHTML = `<span class="reg-name">$${REG_NAMES[i]}</span><span class="reg-val">0x00000000</span>`;
            regsEl.appendChild(row);
        }
        const pcRow = document.createElement('div');
        pcRow.className = 'reg-row';
        pcRow.innerHTML = `<span class="reg-name">hi</span><span class="reg-val" id="reg-hi">0x00000000</span>`;
        regsEl.appendChild(pcRow);
        const loRow = document.createElement('div');
        loRow.className = 'reg-row';
        loRow.innerHTML = `<span class="reg-name">lo</span><span class="reg-val" id="reg-lo">0x00000000</span>`;
        regsEl.appendChild(loRow);
    }

    function fmtHex(v) {
        return '0x' + ((v >>> 0).toString(16).padStart(8, '0'));
    }

    function renderRegs() {
        const rows = regsEl.querySelectorAll('.reg-row');
        for (let i = 0; i < 32; i++) {
            const v = cpu.regs[i] | 0;
            const row = rows[i];
            row.querySelector('.reg-val').textContent = fmtHex(v);
            row.classList.toggle('changed', v !== prevRegs[i]);
        }
        document.getElementById('reg-hi').textContent = fmtHex(cpu.hi);
        document.getElementById('reg-lo').textContent = fmtHex(cpu.lo);
        pcEl.textContent = 'PC = ' + fmtHex(cpu.pc);
        prevRegs = new Int32Array(cpu.regs);
    }

    function renderConsole(error) {
        consoleEl.textContent = '';
        if (cpu.output) {
            const span = document.createElement('span');
            span.className = 'out-program';
            span.textContent = cpu.output;
            consoleEl.appendChild(span);
        }
        if (error) {
            const span = document.createElement('span');
            span.className = 'out-error';
            span.textContent = (cpu.output ? '\n' : '') + '! ' + error;
            consoleEl.appendChild(span);
        }
    }

    function renderMemory() {
        const start = DATA_BASE;
        const end = Math.max(cpu.dataEnd, start + 32);
        const lines = [];
        for (let a = start; a < end; a += 16) {
            let hex = '';
            let ascii = '';
            for (let i = 0; i < 16; i++) {
                const b = cpu.loadByte(a + i);
                hex += (b & 0xff).toString(16).padStart(2, '0') + ' ';
                ascii += (b >= 32 && b < 127) ? String.fromCharCode(b) : '.';
            }
            lines.push(
                `<span class="mem-addr">${fmtHex(a)}</span>  ` +
                `<span class="mem-val">${hex.trim()}</span>  ` +
                `<span class="mem-ascii">|${ascii.replace(/&/g,'&amp;').replace(/</g,'&lt;')}|</span>`
            );
        }
        memoryEl.innerHTML = lines.join('\n') || '<span class="mem-addr">(no .data)</span>';
    }

    function setStatus(text, kind = '') {
        statusEl.textContent = text;
        statusEl.style.color =
            kind === 'error' ? 'var(--red)' :
            kind === 'ok'    ? 'var(--green)' :
            kind === 'run'   ? 'var(--amber)' : '';
    }

    function doAssemble() {
        try {
            assemble(sourceEl.value, cpu);
            prevRegs = new Int32Array(cpu.regs);
            renderRegs(); renderConsole(); renderMemory();
            const insCount = cpu.instrs.size;
            setStatus(`assembled // ${insCount} instructions`, 'ok');
        } catch (e) {
            setStatus(e.message, 'error');
            renderConsole(e.message);
        }
    }

    function doStep() {
        if (cpu.instrs.size === 0) { doAssemble(); }
        if (cpu.halted) { setStatus('halted', 'ok'); return; }
        try {
            cpu.step();
            renderRegs(); renderConsole(); renderMemory();
            setStatus(cpu.halted ? `halted after ${cpu.steps} steps` : `step ${cpu.steps}`, cpu.halted ? 'ok' : 'run');
        } catch (e) {
            setStatus(e.message, 'error');
            renderConsole(e.message);
            renderRegs();
        }
    }

    function doRun() {
        if (cpu.instrs.size === 0) doAssemble();
        try {
            while (!cpu.halted && cpu.steps < MAX_STEPS) cpu.step();
            renderRegs(); renderConsole(); renderMemory();
            if (cpu.steps >= MAX_STEPS) {
                setStatus(`stopped at instruction limit (${MAX_STEPS})`, 'error');
            } else {
                setStatus(`done // ${cpu.steps} instructions executed`, 'ok');
            }
        } catch (e) {
            setStatus(e.message, 'error');
            renderConsole(e.message);
            renderRegs(); renderMemory();
        }
    }

    function doReset() {
        cpu.reset();
        prevRegs = new Int32Array(32);
        renderRegs(); renderConsole(); renderMemory();
        setStatus('reset');
    }

    // Bind buttons
    $('mips-assemble').addEventListener('click', doAssemble);
    $('mips-step').addEventListener('click', doStep);
    $('mips-run').addEventListener('click', doRun);
    $('mips-reset').addEventListener('click', doReset);

    // Tab key inserts a tab in the source area
    sourceEl.addEventListener('keydown', e => {
        if (e.key === 'Tab') {
            e.preventDefault();
            const start = sourceEl.selectionStart;
            const end = sourceEl.selectionEnd;
            sourceEl.value = sourceEl.value.slice(0, start) + '    ' + sourceEl.value.slice(end);
            sourceEl.selectionStart = sourceEl.selectionEnd = start + 4;
        }
    });

    // ---------- Init ----------
    buildSampleSelect();
    buildRegs();
    sampleSel.value = 'sum.s';
    sourceEl.value = SAMPLES['sum.s'];
    renderRegs();
    renderMemory();
    setStatus('idle');
})();
