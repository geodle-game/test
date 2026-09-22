// chess-game.js
// VERSION: 2.7.6 - Fixed horizon-effect blunder (deeper base, stricter convergence)
// COMPATIBLE WITH: chess-ai-database.js (v2.0), index.html, chess-game-database.js (v1.1)

const GAME_VERSION = "2.7.6";

const USE_TT = true;
const TT_BITS = 18;

const EMPTY = 0;
const WP = 1, WN = 2, WB = 3, WR = 4, WQ = 5, WK = 6;
const BP = 7, BN = 8, BB = 9, BR = 10, BQ = 11, BK = 12;

const PIECE_CHAR = ['', '♙', '♘', '♗', '♖', '♕', '♔', '♟', '♞', '♝', '♜', '♛', '♚'];
const PIECE_VALUE_ARR = [0, 100, 320, 330, 500, 900, 20000,
                         100, 320, 330, 500, 900, 20000];

function isWhitePiece(p) { return p >= 1 && p <= 6; }
function isBlackPiece(p) { return p >= 7 && p <= 12; }
function pieceType(p) { return p === 0 ? 0 : (p <= 6 ? p : p - 6); }
function isPlayerPieceCode(p, player) {
    return player === 'white' ? isWhitePiece(p) : isBlackPiece(p);
}
function enemyColor(c) { return c === 'white' ? 'black' : 'white'; }

const SQ_FILES = ['a','b','c','d','e','f','g','h'];
function sqName(sq) { return SQ_FILES[sq & 7] + (8 - (sq >> 3)); }
function sqFromRC(row, col) { return row * 8 + col; }
function sqRow(sq) { return sq >> 3; }
function sqCol(sq) { return sq & 7; }
function isInBounds(row, col) { return row >= 0 && row < 8 && col >= 0 && col < 8; }

const KNIGHT_ATTACKS = new Int8Array(64 * 8);
const KING_ATTACKS = new Int8Array(64 * 8);
const KNIGHT_DEGREE = new Int8Array(64);
const KING_DEGREE = new Int8Array(64);

(function initAttackTables() {
    const knightDeltas = [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]];
    const kingDeltas = [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]];

    for (let sq = 0; sq < 64; sq++) {
        const r = sq >> 3, c = sq & 7;

        let deg = 0;
        for (const [dr, dc] of knightDeltas) {
            const nr = r + dr, nc = c + dc;
            if (nr >= 0 && nr < 8 && nc >= 0 && nc < 8) {
                KNIGHT_ATTACKS[sq * 8 + deg++] = nr * 8 + nc;
            }
        }
        KNIGHT_DEGREE[sq] = deg;
        while (deg < 8) KNIGHT_ATTACKS[sq * 8 + deg++] = -1;

        deg = 0;
        for (const [dr, dc] of kingDeltas) {
            const nr = r + dr, nc = c + dc;
            if (nr >= 0 && nr < 8 && nc >= 0 && nc < 8) {
                KING_ATTACKS[sq * 8 + deg++] = nr * 8 + nc;
            }
        }
        KING_DEGREE[sq] = deg;
        while (deg < 8) KING_ATTACKS[sq * 8 + deg++] = -1;
    }
})();

const ZOBRIST_PIECE_LO = [];
const ZOBRIST_PIECE_HI = [];
const ZOBRIST_SIDE_LO = (Math.random() * 0x100000000) | 0;
const ZOBRIST_SIDE_HI = (Math.random() * 0x100000000) | 0;
const ZOBRIST_CASTLE_LO = [];
const ZOBRIST_CASTLE_HI = [];
const ZOBRIST_EP_LO = [];
const ZOBRIST_EP_HI = [];

(function initZobrist() {
    for (let p = 0; p <= 12; p++) {
        const lo = new Int32Array(64);
        const hi = new Int32Array(64);
        for (let s = 0; s < 64; s++) {
            lo[s] = (Math.random() * 0x100000000) | 0;
            hi[s] = (Math.random() * 0x100000000) | 0;
        }
        ZOBRIST_PIECE_LO[p] = lo;
        ZOBRIST_PIECE_HI[p] = hi;
    }
    for (let i = 0; i < 4; i++) {
        ZOBRIST_CASTLE_LO[i] = (Math.random() * 0x100000000) | 0;
        ZOBRIST_CASTLE_HI[i] = (Math.random() * 0x100000000) | 0;
    }
    for (let i = 0; i < 8; i++) {
        ZOBRIST_EP_LO[i] = (Math.random() * 0x100000000) | 0;
        ZOBRIST_EP_HI[i] = (Math.random() * 0x100000000) | 0;
    }
})();

function computeHash(b, player) {
    let lo = 0, hi = 0;
    for (let sq = 0; sq < 64; sq++) {
        const p = b[sq];
        if (p !== 0) {
            lo ^= ZOBRIST_PIECE_LO[p][sq];
            hi ^= ZOBRIST_PIECE_HI[p][sq];
        }
    }
    if (player === 'black') {
        lo ^= ZOBRIST_SIDE_LO;
        hi ^= ZOBRIST_SIDE_HI;
    }
    if (castlingRights.whiteKingside)  { lo ^= ZOBRIST_CASTLE_LO[0]; hi ^= ZOBRIST_CASTLE_HI[0]; }
    if (castlingRights.whiteQueenside) { lo ^= ZOBRIST_CASTLE_LO[1]; hi ^= ZOBRIST_CASTLE_HI[1]; }
    if (castlingRights.blackKingside)  { lo ^= ZOBRIST_CASTLE_LO[2]; hi ^= ZOBRIST_CASTLE_HI[2]; }
    if (castlingRights.blackQueenside) { lo ^= ZOBRIST_CASTLE_LO[3]; hi ^= ZOBRIST_CASTLE_HI[3]; }
    if (enPassantTarget) {
        const f = enPassantTarget.sq & 7;
        lo ^= ZOBRIST_EP_LO[f];
        hi ^= ZOBRIST_EP_HI[f];
    }
    return { lo: lo | 0, hi: hi | 0 };
}

const TT_SIZE = 1 << TT_BITS;
const TT_MASK = TT_SIZE - 1;
const ttKeys   = new Int32Array(TT_SIZE);
const ttVerify = new Int32Array(TT_SIZE);
const ttScore  = new Int32Array(TT_SIZE);
const ttDepth  = new Int8Array(TT_SIZE);
const ttFlag   = new Int8Array(TT_SIZE);
const ttFrom   = new Int8Array(TT_SIZE);
const ttTo     = new Int8Array(TT_SIZE);

const TT_EXACT = 1, TT_LOWER = 2, TT_UPPER = 3;
const MATE_THRESHOLD = 18000;

let ttHits = 0;
let ttProbes = 0;
let ttStores = 0;
let ttCutoffs = 0;

function ttClear() {
    ttFlag.fill(0);
    ttHits = 0;
    ttProbes = 0;
    ttStores = 0;
    ttCutoffs = 0;
}

function adjustStoreScore(score, ply) {
    if (score > MATE_THRESHOLD) return score + ply;
    if (score < -MATE_THRESHOLD) return score - ply;
    return score;
}
function adjustProbeScore(score, ply) {
    if (score > MATE_THRESHOLD) return score - ply;
    if (score < -MATE_THRESHOLD) return score + ply;
    return score;
}

function ttProbe(lo, hi, depth, alpha, beta, ply) {
    const idx = hi & TT_MASK;
    if (ttFlag[idx] === 0) return null;
    if (ttKeys[idx] !== hi || ttVerify[idx] !== lo) return null;

    const entryDepth = ttDepth[idx];
    const entryScore = adjustProbeScore(ttScore[idx], ply);
    const entryFlag = ttFlag[idx];
    const entryMove = (ttFrom[idx] >= 0) ? { from: ttFrom[idx], to: ttTo[idx] } : null;

    if (entryDepth >= depth) {
        if (entryFlag === TT_EXACT) return { score: entryScore, move: entryMove };
        if (entryFlag === TT_LOWER && entryScore >= beta) return { score: entryScore, move: entryMove };
        if (entryFlag === TT_UPPER && entryScore <= alpha) return { score: entryScore, move: entryMove };
    }
    if (entryMove) return { score: null, move: entryMove };
    return null;
}

function ttStore(lo, hi, depth, score, flag, move) {
    const idx = hi & TT_MASK;
    const existingFlag = ttFlag[idx];
    const existingDepth = ttDepth[idx];
    if (existingFlag !== 0 && existingDepth > depth) {
        if (ttKeys[idx] === hi && ttVerify[idx] === lo) {
            if (existingDepth > depth) return;
        } else {
            return;
        }
    }
    ttKeys[idx] = hi;
    ttVerify[idx] = lo;
    ttDepth[idx] = depth;
    ttFlag[idx] = flag;
    ttScore[idx] = score;
    if (move) {
        ttFrom[idx] = move.from;
        ttTo[idx] = move.to;
    } else {
        ttFrom[idx] = -1;
        ttTo[idx] = -1;
    }
    ttStores++;
}

let board = new Int8Array(64);
let kingSq = { white: 60, black: 4 };
let currentPlayer = 'white';
let castlingRights = { whiteKingside: true, whiteQueenside: true,
                       blackKingside: true, blackQueenside: true };
let enPassantTarget = null;
let halfMoveCount = 0;
let moveCount = 1;

let selectedSquare = null;
let gameHistory = [];
let moveHistory = [];
let uciHistory = [];
let lastMove = null;
let gameOver = false;
let gameMode = 'ai';
let humanPlayer = 'white';
let aiPlayer = 'black';
let isThinking = false;

let enhancedAI = null;
let endgameEngine = null;
let patternLearner = null;
let openingBook = null;
let moveTree = null;

let gamePositionCounts = new Map();

const clockState = {
    enabled: false,
    whiteMs: 0,
    blackMs: 0,
    incrementMs: 0,
    activeAt: 0,
    activePlayer: null
};

let clockDisplayInterval = null;
let currentTimeControl = 'unlimited';

function parseTimeControl(str) {
    if (!str || str === 'unlimited') return null;
    const m = String(str).match(/^(\d+)\+(\d+)$/);
    if (!m) return null;
    return {
        baseMs: parseInt(m[1], 10) * 60 * 1000,
        incrementMs: parseInt(m[2], 10) * 1000
    };
}

function initClock(timeControlStr) {
    currentTimeControl = timeControlStr;
    const tc = parseTimeControl(timeControlStr);
    if (!tc) {
        clockState.enabled = false;
        clockState.whiteMs = 0;
        clockState.blackMs = 0;
        clockState.incrementMs = 0;
        clockState.activePlayer = null;
        clockState.activeAt = 0;
    } else {
        clockState.enabled = true;
        clockState.whiteMs = tc.baseMs;
        clockState.blackMs = tc.baseMs;
        clockState.incrementMs = tc.incrementMs;
        clockState.activePlayer = null;
        clockState.activeAt = performance.now();
    }
    updateClockDisplay();
}

function startClockFor(player) {
    if (!clockState.enabled) return;
    clockState.activePlayer = player;
    clockState.activeAt = performance.now();
}

function commitClock() {
    if (!clockState.enabled || !clockState.activePlayer) return;
    const elapsed = performance.now() - clockState.activeAt;
    const key = clockState.activePlayer + 'Ms';
    clockState[key] = Math.max(0, clockState[key] - elapsed);
    clockState.activeAt = performance.now();
}

function applyIncrement(player) {
    if (!clockState.enabled) return;
    clockState[player + 'Ms'] += clockState.incrementMs;
}

function getRemainingMs(player) {
    if (!clockState.enabled) return Infinity;
    const base = clockState[player + 'Ms'];
    if (clockState.activePlayer === player) {
        return Math.max(0, base - (performance.now() - clockState.activeAt));
    }
    return base;
}

function formatClock(ms) {
    if (!isFinite(ms)) return '∞';
    if (ms < 0) ms = 0;
    if (ms < 10000) return (ms / 1000).toFixed(1);
    const totalSec = Math.floor(ms / 1000);
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
}

function updateClockDisplay() {
    const wEl = document.getElementById('white-clock');
    const bEl = document.getElementById('black-clock');
    if (!wEl || !bEl) return;

    if (!clockState.enabled) {
        wEl.textContent = '∞';
        bEl.textContent = '∞';
        wEl.classList.remove('active', 'low');
        bEl.classList.remove('active', 'low');
        return;
    }

    const wMs = getRemainingMs('white');
    const bMs = getRemainingMs('black');
    wEl.textContent = formatClock(wMs);
    bEl.textContent = formatClock(bMs);

    wEl.classList.toggle('active', currentPlayer === 'white' && !gameOver);
    bEl.classList.toggle('active', currentPlayer === 'black' && !gameOver);
    wEl.classList.toggle('low', wMs < 20000);
    bEl.classList.toggle('low', bMs < 20000);
}

function checkFlagFall() {
    if (!clockState.enabled || gameOver) return;
    const p = currentPlayer;
    if (getRemainingMs(p) > 0) return;

    gameOver = true;
    const winner = p === 'white' ? 'Black' : 'White';
    const statusEl = document.getElementById('status');
    if (statusEl) {
        statusEl.textContent = `${winner} wins on time!`;
        statusEl.classList.add('checkmate');
    }
    updateClockDisplay();
}

function startClockTicker() {
    if (clockDisplayInterval) clearInterval(clockDisplayInterval);
    clockDisplayInterval = setInterval(() => {
        updateClockDisplay();
        checkFlagFall();
    }, 100);
}

function resetBoardToStart() {
    board.fill(0);
    const back = [WR, WN, WB, WQ, WK, WB, WN, WR];
    for (let c = 0; c < 8; c++) {
        board[sqFromRC(0, c)] = back[c] + 6;
        board[sqFromRC(1, c)] = BP;
        board[sqFromRC(6, c)] = WP;
        board[sqFromRC(7, c)] = back[c];
    }
    kingSq.white = 60;
    kingSq.black = 4;
}

function boardToDisplayArray(b) {
    const src = b || board;
    const out = [];
    for (let r = 0; r < 8; r++) {
        const row = [];
        for (let c = 0; c < 8; c++) {
            row.push(PIECE_CHAR[src[sqFromRC(r, c)]]);
        }
        out.push(row);
    }
    return out;
}

function displayArrayToBoard(display) {
    const b = new Int8Array(64);
    for (let r = 0; r < 8; r++) {
        for (let c = 0; c < 8; c++) {
            const ch = display[r][c];
            let found = 0;
            for (let i = 1; i <= 12; i++) if (PIECE_CHAR[i] === ch) { found = i; break; }
            b[sqFromRC(r, c)] = found;
        }
    }
    return b;
}

resetBoardToStart();

function isSquareAttackedBy(b, sq, byColor) {
    const r = sq >> 3, c = sq & 7;

    if (byColor === 'white') {
        if (r < 7) {
            if (c > 0 && b[sqFromRC(r+1, c-1)] === WP) return true;
            if (c < 7 && b[sqFromRC(r+1, c+1)] === WP) return true;
        }
    } else {
        if (r > 0) {
            if (c > 0 && b[sqFromRC(r-1, c-1)] === BP) return true;
            if (c < 7 && b[sqFromRC(r-1, c+1)] === BP) return true;
        }
    }

    const knBase = sq * 8;
    const knDeg = KNIGHT_DEGREE[sq];
    const knightCode = byColor === 'white' ? WN : BN;
    for (let i = 0; i < knDeg; i++) {
        if (b[KNIGHT_ATTACKS[knBase + i]] === knightCode) return true;
    }

    const kBase = sq * 8;
    const kDeg = KING_DEGREE[sq];
    const kingCode = byColor === 'white' ? WK : BK;
    for (let i = 0; i < kDeg; i++) {
        if (b[KING_ATTACKS[kBase + i]] === kingCode) return true;
    }

    const enemyR = byColor === 'white' ? WR : BR;
    const enemyB = byColor === 'white' ? WB : BB;
    const enemyQ = byColor === 'white' ? WQ : BQ;

    for (const [dr, dc] of [[-1,0],[1,0],[0,-1],[0,1]]) {
        let nr = r + dr, nc = c + dc;
        while (nr >= 0 && nr < 8 && nc >= 0 && nc < 8) {
            const p = b[sqFromRC(nr, nc)];
            if (p !== 0) {
                if (p === enemyR || p === enemyQ) return true;
                break;
            }
            nr += dr; nc += dc;
        }
    }
    for (const [dr, dc] of [[-1,-1],[-1,1],[1,-1],[1,1]]) {
        let nr = r + dr, nc = c + dc;
        while (nr >= 0 && nr < 8 && nc >= 0 && nc < 8) {
            const p = b[sqFromRC(nr, nc)];
            if (p !== 0) {
                if (p === enemyB || p === enemyQ) return true;
                break;
            }
            nr += dr; nc += dc;
        }
    }

    return false;
}

function findKingSquare(b, player) {
    const code = player === 'white' ? WK : BK;
    for (let i = 0; i < 64; i++) if (b[i] === code) return i;
    return -1;
}

function isKingInCheckForPosition(b, player) {
    const k = (b === board) ? (player === 'white' ? kingSq.white : kingSq.black) : findKingSquare(b, player);
    if (k < 0) return false;
    return isSquareAttackedBy(b, k, enemyColor(player));
}

function makeMoveOnBoard(b, move) {
    const from = move.from, to = move.to;
    const piece = b[from];
    const captured = b[to];

    move.undo = {
        captured,
        castlingRights: { ...castlingRights },
        enPassant: enPassantTarget,
        halfMoveCount,
        kingSqWhite: kingSq.white,
        kingSqBlack: kingSq.black,
        epCaptureSq: -1,
        wasCastle: false,
        rookFrom: -1,
        rookTo: -1
    };

    if (pieceType(piece) === 1 && enPassantTarget && to === enPassantTarget.sq && !captured) {
        const dir = isWhitePiece(piece) ? 8 : -8;
        const epSq = to + dir;
        move.undo.epCaptureSq = epSq;
        b[epSq] = 0;
    }

    if (pieceType(piece) === 6 && Math.abs(sqCol(to) - sqCol(from)) === 2) {
        const homeRow = sqRow(from);
        const isKingside = to > from;
        const rookFrom = sqFromRC(homeRow, isKingside ? 7 : 0);
        const rookTo = sqFromRC(homeRow, isKingside ? 5 : 3);
        b[rookTo] = b[rookFrom];
        b[rookFrom] = 0;
        move.undo.wasCastle = true;
        move.undo.rookFrom = rookFrom;
        move.undo.rookTo = rookTo;
    }

    b[to] = piece;
    b[from] = 0;

    if (move.promo && pieceType(piece) === 1) {
        b[to] = isWhitePiece(piece) ? move.promo : move.promo + 6;
    }

    if (pieceType(piece) === 6) {
        if (isWhitePiece(piece)) kingSq.white = to;
        else kingSq.black = to;
    }

    if (pieceType(piece) === 6) {
        if (isWhitePiece(piece)) { castlingRights.whiteKingside = false; castlingRights.whiteQueenside = false; }
        else { castlingRights.blackKingside = false; castlingRights.blackQueenside = false; }
    }
    if (from === 63 || to === 63) castlingRights.whiteKingside = false;
    if (from === 56 || to === 56) castlingRights.whiteQueenside = false;
    if (from === 7 || to === 7) castlingRights.blackKingside = false;
    if (from === 0 || to === 0) castlingRights.blackQueenside = false;

    enPassantTarget = null;
    if (pieceType(piece) === 1 && Math.abs(sqRow(to) - sqRow(from)) === 2) {
        const epRow = (sqRow(from) + sqRow(to)) >> 1;
        enPassantTarget = { sq: sqFromRC(epRow, sqCol(from)) };
    }

    if (pieceType(piece) === 1 || captured) halfMoveCount = 0;
    else halfMoveCount++;
}

function unmakeMoveOnBoard(b, move) {
    const from = move.from, to = move.to;
    const undo = move.undo;
    if (!undo) return;

    let piece = b[to];
    if (move.promo && pieceType(piece) !== 1) {
        piece = isWhitePiece(piece) ? WP : BP;
    }

    b[from] = piece;
    b[to] = undo.captured;

    if (undo.epCaptureSq >= 0) {
        const dir = isWhitePiece(piece) ? 8 : -8;
        b[to + dir] = isWhitePiece(piece) ? BP : WP;
    }

    if (undo.wasCastle) {
        b[undo.rookFrom] = b[undo.rookTo];
        b[undo.rookTo] = 0;
    }

    if (pieceType(piece) === 6) {
        if (isWhitePiece(piece)) kingSq.white = undo.kingSqWhite;
        else kingSq.black = undo.kingSqBlack;
    }

    castlingRights.whiteKingside = undo.castlingRights.whiteKingside;
    castlingRights.whiteQueenside = undo.castlingRights.whiteQueenside;
    castlingRights.blackKingside = undo.castlingRights.blackKingside;
    castlingRights.blackQueenside = undo.castlingRights.blackQueenside;
    enPassantTarget = undo.enPassant;
    halfMoveCount = undo.halfMoveCount;
}

function generatePseudoMoves(b, player) {
    const moves = [];
    const isWhite = player === 'white';

    for (let from = 0; from < 64; from++) {
        const piece = b[from];
        if (piece === 0) continue;
        if (isWhitePiece(piece) !== isWhite) continue;
        const r = from >> 3, c = from & 7;
        const type = pieceType(piece);

        if (type === 1) {
            const dir = isWhite ? -1 : 1;
            const startRow = isWhite ? 6 : 1;
            const promoRow = isWhite ? 0 : 7;

            const r1 = r + dir;
            if (r1 >= 0 && r1 < 8) {
                const to1 = sqFromRC(r1, c);
                if (b[to1] === 0) {
                    if (r1 === promoRow) {
                        for (const p of [5, 4, 3, 2]) {
                            moves.push({ from, to: to1, promo: p });
                        }
                    } else {
                        moves.push({ from, to: to1, promo: 0 });
                        if (r === startRow) {
                            const r2 = r + 2 * dir;
                            const to2 = sqFromRC(r2, c);
                            if (b[to2] === 0) moves.push({ from, to: to2, promo: 0 });
                        }
                    }
                }
            }

            for (const dc of [-1, 1]) {
                const nr = r + dir, nc = c + dc;
                if (nr < 0 || nr > 7 || nc < 0 || nc > 7) continue;
                const to = sqFromRC(nr, nc);
                const target = b[to];
                if (target !== 0 && (isWhitePiece(target) !== isWhite)) {
                    if (nr === promoRow) {
                        for (const p of [5, 4, 3, 2]) {
                            moves.push({ from, to, promo: p });
                        }
                    } else {
                        moves.push({ from, to, promo: 0 });
                    }
                } else if (enPassantTarget && to === enPassantTarget.sq && target === 0) {
                    moves.push({ from, to, promo: 0 });
                }
            }
        } else if (type === 2) {
            const base = from * 8;
            const deg = KNIGHT_DEGREE[from];
            for (let i = 0; i < deg; i++) {
                const to = KNIGHT_ATTACKS[base + i];
                const target = b[to];
                if (target === 0 || (isWhitePiece(target) !== isWhite)) {
                    moves.push({ from, to, promo: 0 });
                }
            }
        } else if (type === 6) {
            const base = from * 8;
            const deg = KING_DEGREE[from];
            for (let i = 0; i < deg; i++) {
                const to = KING_ATTACKS[base + i];
                const target = b[to];
                if (target === 0 || (isWhitePiece(target) !== isWhite)) {
                    moves.push({ from, to, promo: 0 });
                }
            }

            const homeRow = isWhite ? 7 : 0;
            if (r === homeRow && c === 4) {
                const rookCode = isWhite ? WR : BR;
                const canKS = isWhite ? castlingRights.whiteKingside : castlingRights.blackKingside;
                const canQS = isWhite ? castlingRights.whiteQueenside : castlingRights.blackQueenside;
                const enemy = enemyColor(player);

                if (canKS && b[sqFromRC(homeRow, 7)] === rookCode &&
                    b[sqFromRC(homeRow, 5)] === 0 && b[sqFromRC(homeRow, 6)] === 0) {
                    if (!isSquareAttackedBy(b, sqFromRC(homeRow, 4), enemy) &&
                        !isSquareAttackedBy(b, sqFromRC(homeRow, 5), enemy) &&
                        !isSquareAttackedBy(b, sqFromRC(homeRow, 6), enemy)) {
                        moves.push({ from, to: sqFromRC(homeRow, 6), promo: 0 });
                    }
                }
                if (canQS && b[sqFromRC(homeRow, 0)] === rookCode &&
                    b[sqFromRC(homeRow, 1)] === 0 && b[sqFromRC(homeRow, 2)] === 0 && b[sqFromRC(homeRow, 3)] === 0) {
                    if (!isSquareAttackedBy(b, sqFromRC(homeRow, 4), enemy) &&
                        !isSquareAttackedBy(b, sqFromRC(homeRow, 3), enemy) &&
                        !isSquareAttackedBy(b, sqFromRC(homeRow, 2), enemy)) {
                        moves.push({ from, to: sqFromRC(homeRow, 2), promo: 0 });
                    }
                }
            }
        } else {
            let dirs;
            if (type === 4) dirs = [[-1,0],[1,0],[0,-1],[0,1]];
            else if (type === 3) dirs = [[-1,-1],[-1,1],[1,-1],[1,1]];
            else dirs = [[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[-1,1],[1,-1],[1,1]];

            for (const [dr, dc] of dirs) {
                let nr = r + dr, nc = c + dc;
                while (nr >= 0 && nr < 8 && nc >= 0 && nc < 8) {
                    const to = sqFromRC(nr, nc);
                    const target = b[to];
                    if (target === 0) {
                        moves.push({ from, to, promo: 0 });
                    } else {
                        if (isWhitePiece(target) !== isWhite) moves.push({ from, to, promo: 0 });
                        break;
                    }
                    nr += dr; nc += dc;
                }
            }
        }
    }

    return moves;
}

function getAllPossibleMovesForPosition(b, player) {
    const pseudo = generatePseudoMoves(b, player);
    const legal = [];
    const enemy = enemyColor(player);

    for (const move of pseudo) {
        makeMoveOnBoard(b, move);
        if (!isSquareAttackedBy(b, kingSq[player], enemy)) {
            legal.push(move);
        }
        unmakeMoveOnBoard(b, move);
    }

    return legal;
}

function isValidMove(fromRow, fromCol, toRow, toCol) {
    if (toRow < 0 || toRow > 7 || toCol < 0 || toCol > 7) return false;
    const from = sqFromRC(fromRow, fromCol);
    const to = sqFromRC(toRow, toCol);
    const piece = board[from];
    if (piece === 0) return false;
    if (!isPlayerPieceCode(piece, currentPlayer)) return false;
    const target = board[to];
    if (target !== 0 && isPlayerPieceCode(target, currentPlayer)) return false;
    const legal = getAllPossibleMovesForPosition(board, currentPlayer);
    for (const m of legal) {
        if (m.from === from && m.to === to) return true;
    }
    return false;
}

function isKingInCheck(b, player) {
    return isKingInCheckForPosition(b, player);
}

function isPlayerPiece(piece, player) {
    if (typeof piece === 'number') return isPlayerPieceCode(piece, player);
    return false;
}

const SAN_LETTER = ['', '', 'N', 'B', 'R', 'Q', 'K', '', 'N', 'B', 'R', 'Q', 'K'];

function toSAN(b, move, player) {
    if (!b || !move) return '?';
    const from = move.from, to = move.to;
    const piece = b[from];
    if (piece === 0) return '?';
    const type = pieceType(piece);
    const target = b[to];

    if (type === 6 && Math.abs(sqCol(to) - sqCol(from)) === 2) {
        const isKingside = to > from;
        let san = isKingside ? 'O-O' : 'O-O-O';
        san += checkSuffix(b, move, player);
        return san;
    }

    const dest = sqName(to);
    let san = '';

    if (type === 1) {
        const isCapture = target !== 0 || (enPassantTarget && to === enPassantTarget.sq && !target);
        if (isCapture) san += sqName(from)[0] + 'x' + dest;
        else san += dest;
        if (move.promo) san += '=' + SAN_LETTER[move.promo];
    } else {
        san += SAN_LETTER[piece];
        const samePieces = [];
        const legal = getAllPossibleMovesForPosition(b, player);
        for (const m of legal) {
            if (m.from === from || m.to !== to) continue;
            if (b[m.from] === piece) samePieces.push(m);
        }
        if (samePieces.length > 0) {
            const sameFile = samePieces.some(m => sqCol(m.from) === sqCol(from));
            const sameRank = samePieces.some(m => sqRow(m.from) === sqRow(from));
            if (!sameFile) san += sqName(from)[0];
            else if (!sameRank) san += sqName(from)[1];
            else san += sqName(from);
        }
        if (target !== 0) san += 'x';
        san += dest;
    }
    san += checkSuffix(b, move, player);
    return san;
}

function checkSuffix(b, move, player) {
    makeMoveOnBoard(b, move);
    const enemy = enemyColor(player);
    let suffix = '';
    if (isSquareAttackedBy(b, kingSq[enemy], player)) {
        const responses = getAllPossibleMovesForPosition(b, enemy);
        suffix = responses.length === 0 ? '#' : '+';
    }
    unmakeMoveOnBoard(b, move);
    return suffix;
}

const evalCache = new Map();
const CACHE_LIMIT = 500000;

function boardToHash(b) {
    let s = '';
    for (let i = 0; i < 64; i++) s += String.fromCharCode(48 + b[i]);
    return s;
}

function cacheGet(cache, key) {
    const e = cache.get(key);
    return e === undefined ? undefined : e.value;
}
function cacheSet(cache, key, value) {
    if (cache.size > CACHE_LIMIT) cache.clear();
    cache.set(key, { value });
}

function pieceMobility(b, sq, player) {
    const piece = b[sq];
    if (piece === 0) return 0;
    const type = pieceType(piece);
    const isWhite = isWhitePiece(piece);
    const r = sq >> 3, c = sq & 7;
    let count = 0;

    if (type === 1) {
        const dir = isWhite ? -1 : 1;
        const r1 = r + dir;
        if (r1 >= 0 && r1 < 8) {
            if (b[sqFromRC(r1, c)] === 0) count++;
            if (c > 0 && b[sqFromRC(r1, c-1)] !== 0 && isWhitePiece(b[sqFromRC(r1, c-1)]) !== isWhite) count++;
            if (c < 7 && b[sqFromRC(r1, c+1)] !== 0 && isWhitePiece(b[sqFromRC(r1, c+1)]) !== isWhite) count++;
        }
    } else if (type === 2) {
        const base = sq * 8;
        for (let i = 0; i < KNIGHT_DEGREE[sq]; i++) {
            const t = b[KNIGHT_ATTACKS[base + i]];
            if (t === 0 || isWhitePiece(t) !== isWhite) count++;
        }
    } else if (type === 3 || type === 4 || type === 5) {
        let dirs;
        if (type === 4) dirs = [[-1,0],[1,0],[0,-1],[0,1]];
        else if (type === 3) dirs = [[-1,-1],[-1,1],[1,-1],[1,1]];
        else dirs = [[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[-1,1],[1,-1],[1,1]];
        for (const [dr, dc] of dirs) {
            let nr = r + dr, nc = c + dc;
            while (nr >= 0 && nr < 8 && nc >= 0 && nc < 8) {
                const t = b[sqFromRC(nr, nc)];
                if (t === 0) { count++; }
                else { if (isWhitePiece(t) !== isWhite) count++; break; }
                nr += dr; nc += dc;
            }
        }
    } else if (type === 6) {
        const base = sq * 8;
        for (let i = 0; i < KING_DEGREE[sq]; i++) {
            const t = b[KING_ATTACKS[base + i]];
            if (t === 0 || isWhitePiece(t) !== isWhite) count++;
        }
    }
    return count;
}

function countShieldPawns(b, kSq, isWhite) {
    const kRow = kSq >> 3;
    const kCol = kSq & 7;
    const backRank = isWhite ? 7 : 0;
    if (kRow !== backRank) return 0;
    const pawnRow = isWhite ? 6 : 1;
    const pawnCode = isWhite ? WP : BP;
    let count = 0;
    for (let dc = -1; dc <= 1; dc++) {
        const c = kCol + dc;
        if (c < 0 || c > 7) continue;
        if (b[sqFromRC(pawnRow, c)] === pawnCode) count++;
    }
    return count;
}

function isKnightOutpost(b, sq, isWhite) {
    const r = sq >> 3, c = sq & 7;
    if (r < 2 || r > 5) return false;
    let defended = false;
    if (isWhite) {
        if (c > 0 && r < 7 && b[sqFromRC(r+1, c-1)] === WP) defended = true;
        if (c < 7 && r < 7 && b[sqFromRC(r+1, c+1)] === WP) defended = true;
    } else {
        if (c > 0 && r > 0 && b[sqFromRC(r-1, c-1)] === BP) defended = true;
        if (c < 7 && r > 0 && b[sqFromRC(r-1, c+1)] === BP) defended = true;
    }
    if (!defended) return false;
    const enemyPawn = isWhite ? BP : WP;
    for (const df of [-1, 1]) {
        const f = c + df;
        if (f < 0 || f > 7) continue;
        if (isWhite) {
            for (let pr = 0; pr < r; pr++) {
                if (b[sqFromRC(pr, f)] === enemyPawn) return false;
            }
        } else {
            for (let pr = r + 1; pr < 8; pr++) {
                if (b[sqFromRC(pr, f)] === enemyPawn) return false;
            }
        }
    }
    return true;
}

function pawnStormDanger(b, kSq, attackerIsWhite) {
    const kFile = kSq & 7;
    const attackerPawn = attackerIsWhite ? WP : BP;
    let danger = 0;
    for (let sq = 0; sq < 64; sq++) {
        if (b[sq] !== attackerPawn) continue;
        const r = sq >> 3, c = sq & 7;
        const fileDist = Math.abs(c - kFile);
        if (fileDist > 3) continue;
        const advance = attackerIsWhite ? (6 - r) : (r - 1);
        if (advance <= 0) continue;
        const fileWeight = Math.max(1, 4 - fileDist);
        danger += advance * fileWeight * 15;
    }
    return danger;
}

// v2.7.4: Is this pawn passed? No enemy pawn on the same or adjacent files
// ahead of it toward the promotion rank.
function isPassedPawn(b, sq, isWhite) {
    const r = sq >> 3, c = sq & 7;
    const enemyPawn = isWhite ? BP : WP;
    for (let df = -1; df <= 1; df++) {
        const f = c + df;
        if (f < 0 || f > 7) continue;
        if (isWhite) {
            for (let rr = 0; rr < r; rr++) {
                if (b[sqFromRC(rr, f)] === enemyPawn) return false;
            }
        } else {
            for (let rr = r + 1; rr < 8; rr++) {
                if (b[sqFromRC(rr, f)] === enemyPawn) return false;
            }
        }
    }
    return true;
}

function evaluatePositionForSearch(b, player, moveNumber) {
    if (!b) return 0;
    const key = boardToHash(b) + "|" + moveNumber;
    const cached = cacheGet(evalCache, key);
    if (cached !== undefined) return cached;

    let score = 0;
    let materialDiff = 0;
    let pieceCount = 0;
    let wNonPawnMaterial = 0;
    let bNonPawnMaterial = 0;
    let wBishopCount = 0;
    let bBishopCount = 0;

    let wUndevelopedMinors = 0;
    let bUndevelopedMinors = 0;
    for (let sq = 0; sq < 64; sq++) {
        const p = b[sq];
        if (p === 0) continue;
        const pt = pieceType(p);
        if (pt !== 2 && pt !== 3) continue;
        const backRank = isWhitePiece(p) ? 7 : 0;
        if ((sq >> 3) === backRank) {
            if (isWhitePiece(p)) wUndevelopedMinors++;
            else bUndevelopedMinors++;
        }
    }

    for (let sq = 0; sq < 64; sq++) {
        const p = b[sq];
        if (p === 0) continue;
        const v = PIECE_VALUE_ARR[p];
        if (isWhitePiece(p)) { score += v; materialDiff += v; }
        else { score -= v; materialDiff -= v; }
        if (pieceType(p) !== 6) pieceCount++;

        const pt = pieceType(p);
        if (pt === 3) {
            if (isWhitePiece(p)) wBishopCount++;
            else bBishopCount++;
        }
        if (pt !== 1 && pt !== 6) {
            if (isWhitePiece(p)) wNonPawnMaterial += v;
            else bNonPawnMaterial += v;
        }

        const mob = pieceMobility(b, sq, isWhitePiece(p) ? 'white' : 'black');
        const weight = pt === 2 ? 8 : pt === 3 ? 6 : pt === 4 ? 4 : pt === 5 ? 1 : 1;
        score += (isWhitePiece(p) ? 1 : -1) * mob * weight * 0.5;

        const r = sq >> 3, c = sq & 7;
        const centerDist = Math.abs(r - 3.5) + Math.abs(c - 3.5);
        const centerBonus = Math.max(0, 7 - centerDist * 1.5);
        score += (isWhitePiece(p) ? 1 : -1) * centerBonus * 0.5;

        const isWhite = isWhitePiece(p);

        if (pt === 1) {
            const pawn = p;
            // Doubled pawn
            let doubled = false;
            for (let rr = 0; rr < 8; rr++) {
                if (rr !== r && b[sqFromRC(rr, c)] === pawn) { doubled = true; break; }
            }
            if (doubled) score += isWhite ? -12 : 12;
            // Isolated pawn
            let isolated = true;
            for (const df of [-1, 1]) {
                const f = c + df;
                if (f < 0 || f > 7) continue;
                for (let rr = 0; rr < 8; rr++) {
                    if (b[sqFromRC(rr, f)] === pawn) { isolated = false; break; }
                }
                if (!isolated) break;
            }
            if (isolated) score += isWhite ? -15 : 15;
        }

        if (pt === 2 || pt === 3) {
            const backRank = isWhite ? 7 : 0;
            if ((sq >> 3) === backRank) {
                score += isWhite ? (pt === 2 ? -25 : -15) : (pt === 2 ? 25 : 15);
            }
        }

        // Knight outpost
        if (pt === 2) {
            if (isKnightOutpost(b, sq, isWhite)) score += isWhite ? 30 : -30;
        }

        // Rook file openness
        if (pt === 4) {
            const ownPawn = isWhite ? WP : BP;
            const enemyPawn = isWhite ? BP : WP;
            let hasOwn = false, hasEnemy = false;
            for (let rr = 0; rr < 8; rr++) {
                const pp = b[sqFromRC(rr, c)];
                if (pp === ownPawn) hasOwn = true;
                else if (pp === enemyPawn) hasEnemy = true;
            }
            if (!hasOwn && !hasEnemy) score += isWhite ? 25 : -25;
            else if (!hasOwn) score += isWhite ? 12 : -12;
        }

        if (pt === 5) {
            const startSq = isWhite ? 59 : 3;
            if (sq !== startSq) {
                const ownUndeveloped = isWhite ? wUndevelopedMinors : bUndevelopedMinors;
                const penalty = 30 * ownUndeveloped;
                score += isWhite ? -penalty : penalty;
            }
        }
    }

    // Bishop pair
    if (wBishopCount >= 2) score += 25;
    if (bBishopCount >= 2) score -= 25;

    function countConnectedRooks(b, code) {
        const rooks = [];
        for (let sq = 0; sq < 64; sq++) if (b[sq] === code) rooks.push(sq);
        if (rooks.length < 2) return 0;
        let count = 0;
        for (let i = 0; i < rooks.length; i++) {
            for (let j = i + 1; j < rooks.length; j++) {
                const a = rooks[i], c2 = rooks[j];
                const ar = a >> 3, ac = a & 7;
                const cr = c2 >> 3, cc = c2 & 7;
                if (ar === cr) {
                    const lo = Math.min(ac, cc), hi = Math.max(ac, cc);
                    let clear = true;
                    for (let x = lo + 1; x < hi; x++) {
                        if (b[sqFromRC(ar, x)] !== 0) { clear = false; break; }
                    }
                    if (clear) count++;
                } else if (ac === cc) {
                    const lo = Math.min(ar, cr), hi = Math.max(ar, cr);
                    let clear = true;
                    for (let x = lo + 1; x < hi; x++) {
                        if (b[sqFromRC(x, ac)] !== 0) { clear = false; break; }
                    }
                    if (clear) count++;
                }
            }
        }
        return count;
    }
    score += 20 * countConnectedRooks(b, WR);
    score -= 20 * countConnectedRooks(b, BR);

    const KING_SAFETY_THRESHOLD = 900;
    const KING_SAFETY_BONUS = 45;

    const wKing = kingSq.white, bKing = kingSq.black;
    const wKingRow = wKing >> 3, wKingCol = wKing & 7;
    const bKingRow = bKing >> 3, bKingCol = bKing & 7;

    if (bNonPawnMaterial >= KING_SAFETY_THRESHOLD) {
        if (wKingRow === 7 && wKingCol !== 4 && countShieldPawns(b, wKing, true) >= 2) {
            score += KING_SAFETY_BONUS;
        }
    }
    if (wNonPawnMaterial >= KING_SAFETY_THRESHOLD) {
        if (bKingRow === 0 && bKingCol !== 4 && countShieldPawns(b, bKing, false) >= 2) {
            score -= KING_SAFETY_BONUS;
        }
    }

    let wKingDanger = 0, bKingDanger = 0;
    let wKingEscapes = 0, bKingEscapes = 0;

    for (let sq = 0; sq < 64; sq++) {
        const p = b[sq];
        if (p === 0) continue;
        if (isBlackPiece(p)) {
            const d = Math.abs((sq>>3) - (wKing>>3)) + Math.abs((sq&7) - (wKing&7));
            if (d <= 3 && pieceType(p) !== 6) wKingDanger += 15;
        } else {
            const d = Math.abs((sq>>3) - (bKing>>3)) + Math.abs((sq&7) - (bKing&7));
            if (d <= 3 && pieceType(p) !== 6) bKingDanger += 15;
        }
    }

    wKingDanger += pawnStormDanger(b, wKing, false);
    bKingDanger += pawnStormDanger(b, bKing, true);

    if (isSquareAttackedBy(b, wKing, 'black')) wKingDanger += 200;
    if (isSquareAttackedBy(b, bKing, 'white')) bKingDanger += 200;

    for (let i = 0; i < KING_DEGREE[wKing]; i++) {
        const t = KING_ATTACKS[wKing * 8 + i];
        if (b[t] === 0 && !isSquareAttackedBy(b, t, 'black')) wKingEscapes++;
    }
    for (let i = 0; i < KING_DEGREE[bKing]; i++) {
        const t = KING_ATTACKS[bKing * 8 + i];
        if (b[t] === 0 && !isSquareAttackedBy(b, t, 'white')) bKingEscapes++;
    }
    if (wKingEscapes === 0) wKingDanger += 300;
    if (bKingEscapes === 0) bKingDanger += 300;

    score -= wKingDanger * 0.5;
    score += bKingDanger * 0.5;

    // ============================================================
    // PAWN ADVANCEMENT (v2.7.5)
    // Bonuses must ALWAYS leave pawn+bonus < queen (900), otherwise
    // the search prefers keeping a 7th-rank pawn over promoting it.
    // ============================================================
    for (let sq = 0; sq < 64; sq++) {
        const p = b[sq];
        if (p === WP) {
            const r = sq >> 3;
            const passed = isPassedPawn(b, sq, true);
            if (r === 1) {
                score += 400;
                if (passed) score += 150;   // pawn + bonus ≤ 650 < queen
            } else if (r === 2) {
                score += 150;
                if (passed) score += 50;
            } else if (r === 3) {
                score += 50;
            }
        } else if (p === BP) {
            const r = sq >> 3;
            const passed = isPassedPawn(b, sq, false);
            if (r === 6) {
                score -= 400;
                if (passed) score -= 150;
            } else if (r === 5) {
                score -= 150;
                if (passed) score -= 50;
            } else if (r === 4) {
                score -= 50;
            }
        }
    }

    // ============================================================
    // K+P vs K endgame knowledge (v2.7.5)
    // Reward:  king in front of the pawn, escorting it.
    // Penalize: king stuck in the corner in front of its own pawn (draw).
    // ============================================================
    if (pieceCount <= 3) {
        for (let sq = 0; sq < 64; sq++) {
            const p = b[sq];
            if (p !== WP && p !== BP) continue;
            const pr = sq >> 3, pc = sq & 7;

            if (p === WP) {
                if (wKingRow < pr && Math.abs(wKingCol - pc) <= 1) score += 120;
                if (wKingRow === 0 && wKingCol === pc && (pc === 0 || pc === 7)) score -= 250;
                if (pr === 1 && wKingRow === 0 && Math.abs(wKingCol - pc) <= 1) score -= 80;
            } else {
                if (bKingRow > pr && Math.abs(bKingCol - pc) <= 1) score -= 120;
                if (bKingRow === 7 && bKingCol === pc && (pc === 0 || pc === 7)) score += 250;
                if (pr === 6 && bKingRow === 7 && Math.abs(bKingCol - pc) <= 1) score += 80;
            }
        }
    }

    if (pieceCount <= 10) {
        score += ((7 - (wKing >> 3)) + (wKing & 7)) * 3;
        score -= ((bKing >> 3) + (7 - (bKing & 7))) * 3;

        // ============================================================
        // v2.7.5: Only "drive the enemy king to the edge" when we have
        // an actual mating force on the board (R/Q or 2+ minors ahead).
        // ============================================================
        const wEdgeDist = Math.min(wKingRow, 7 - wKingRow, wKingCol, 7 - wKingCol);
        const bEdgeDist = Math.min(bKingRow, 7 - bKingRow, bKingCol, 7 - bKingCol);

        const wHeavy = wNonPawnMaterial - bNonPawnMaterial;
        const bHeavy = bNonPawnMaterial - wNonPawnMaterial;
        const hasMatingForce_White = wHeavy >= 500;
        const hasMatingForce_Black = bHeavy >= 500;

        if (materialDiff > 300 && hasMatingForce_White) {
            score += (3 - bEdgeDist) * 30;
        } else if (materialDiff < -300 && hasMatingForce_Black) {
            score -= (3 - wEdgeDist) * 30;
        }
    }

    cacheSet(evalCache, key, score);
    return score;
}

function isEndgamePositionForPosition(b) {
    let count = 0;
    for (let sq = 0; sq < 64; sq++) {
        const p = b[sq];
        if (p !== 0 && pieceType(p) !== 6) count++;
    }
    return count <= 10;
}

function hasNonPawnMaterial(b, player) {
    const isWhite = player === 'white';
    for (let sq = 0; sq < 64; sq++) {
        const p = b[sq];
        if (p === 0) continue;
        if (isWhitePiece(p) !== isWhite) continue;
        const t = pieceType(p);
        if (t !== 1 && t !== 6) return true;
    }
    return false;
}

// ============================================================
// v2.7.6: Deeper base depth so 4-ply-deep tactical traps are
// visible before the extension loop bails out. Stricter
// convergence (2 stable iterations) prevents premature stop.
// ============================================================
const SEARCH_CONFIG = {
    baseDepth: 5,
    endgameDepth: 7,
    quiescenceDepth: 3,
    hardMaxDepth: 9
};

const EXTENSION_SCORE_THRESHOLD = 25;
const EXTENSION_STABLE_LIMIT = 2;
let extensionSoftDeadline = 0;

let searchStartTime = 0;
let searchDeadline = Infinity;
let searchAborted = false;
let nodesSearched = 0;

let searchLinePositions = [];
let avoidRepetition = false;
let rootEvalWhite = 0;
const REPETITION_PENALTY = 30;

const MAX_PLY = 64;
let killerMoves = [];

function resetKillerMoves() {
    killerMoves = new Array(MAX_PLY);
    for (let i = 0; i < MAX_PLY; i++) killerMoves[i] = [null, null];
}

function storeKiller(ply, move) {
    if (ply >= MAX_PLY) return;
    const k = killerMoves[ply];
    if (k[0] && k[0].from === move.from && k[0].to === move.to) return;
    k[1] = k[0];
    k[0] = { from: move.from, to: move.to };
}

function orderScore(b, move, killers) {
    const captureVal = PIECE_VALUE_ARR[b[move.to]] || 0;
    if (captureVal > 0) return 100000 + captureVal;
    if (killers) {
        if (killers[0] && move.from === killers[0].from && move.to === killers[0].to) return 90000;
        if (killers[1] && move.from === killers[1].from && move.to === killers[1].to) return 80000;
    }
    return 0;
}

function checkTimeOut() {
    nodesSearched++;
    if ((nodesSearched & 0x3FF) === 0) {
        if (performance.now() > searchDeadline) {
            searchAborted = true;
            return true;
        }
    }
    return false;
}

function quiescenceSearch(b, alpha, beta, player, qDepth) {
    if (checkTimeOut()) return 0;

    const standPat = evaluatePositionForSearch(b, player, moveCount);
    if (!isFinite(standPat)) return 0;

    if (player === 'white') {
        if (standPat >= beta) return beta;
        if (alpha < standPat) alpha = standPat;
    } else {
        if (standPat <= alpha) return alpha;
        if (beta > standPat) beta = standPat;
    }

    if (qDepth <= 0) {
        const result = player === 'white' ? alpha : beta;
        return isFinite(result) ? result : 0;
    }

    const moves = getAllPossibleMovesForPosition(b, player);
    if (moves.length === 0) {
        if (isSquareAttackedBy(b, kingSq[player], enemyColor(player))) {
            return player === 'white' ? -20000 : 20000;
        }
        return 0;
    }

    const inCheck = isSquareAttackedBy(b, kingSq[player], enemyColor(player));
    const candidates = inCheck ? moves : moves.filter(m => b[m.to] !== 0);

    candidates.sort((a, b1) => {
        const va = PIECE_VALUE_ARR[b[a.to]] - PIECE_VALUE_ARR[b[a.from]] / 10;
        const vb = PIECE_VALUE_ARR[b[b1.to]] - PIECE_VALUE_ARR[b[b1.from]] / 10;
        return vb - va;
    });

    const enemy = enemyColor(player);
    for (const move of candidates) {
        if (searchAborted) {
            const result = player === 'white' ? alpha : beta;
            return isFinite(result) ? result : 0;
        }
        makeMoveOnBoard(b, move);
        if (isSquareAttackedBy(b, kingSq[player], enemy)) {
            unmakeMoveOnBoard(b, move);
            continue;
        }
        const score = quiescenceSearch(b, alpha, beta, enemy, qDepth - 1);
        unmakeMoveOnBoard(b, move);
        if (player === 'white') {
            if (score > alpha) alpha = score;
            if (alpha >= beta) return beta;
        } else {
            if (score < beta) beta = score;
            if (beta <= alpha) return alpha;
        }
    }
    const result = player === 'white' ? alpha : beta;
    return isFinite(result) ? result : 0;
}

function minimax(b, depth, alpha, beta, player, ply, checkExt, allowNull) {
    if (checkTimeOut()) return 0;

    const originalAlpha = alpha;
    let hashLo = 0, hashHi = 0;
    let ttHitMove = null;

    if (USE_TT && ply > 0) {
        const h = computeHash(b, player);
        hashLo = h.lo;
        hashHi = h.hi;
        ttProbes++;
        const hit = ttProbe(hashLo, hashHi, depth, alpha, beta, ply);
        if (hit) {
            if (hit.score !== null) {
                ttHits++;
                if (hit.score <= alpha || hit.score >= beta) ttCutoffs++;
                return hit.score;
            }
            if (hit.move) ttHitMove = hit.move;
        }
    }

    const posKey = boardToHash(b) + player[0];
    if (ply > 0 && searchLinePositions.includes(posKey)) {
        return avoidRepetition ? (rootEvalWhite > 0 ? -REPETITION_PENALTY : REPETITION_PENALTY) : 0;
    }
    searchLinePositions.push(posKey);

    const enemy = enemyColor(player);
    const inCheck = isSquareAttackedBy(b, kingSq[player], enemy);

    const moves = getAllPossibleMovesForPosition(b, player);
    if (moves.length === 0) {
        searchLinePositions.pop();
        if (inCheck) {
            return player === 'white' ? (-20000 + ply) : (20000 - ply);
        }
        return 0;
    }

    if (depth <= 0 && !inCheck) {
        searchLinePositions.pop();
        return quiescenceSearch(b, alpha, beta, player, SEARCH_CONFIG.quiescenceDepth);
    }

    if (depth <= 0 && inCheck) {
        if (checkExt < 4) {
            depth = 1;
            checkExt++;
        } else {
            searchLinePositions.pop();
            return quiescenceSearch(b, alpha, beta, player, SEARCH_CONFIG.quiescenceDepth);
        }
    }

    const hasPieces = hasNonPawnMaterial(b, player);
    if (allowNull && !inCheck && depth >= 3 && hasPieces && !isEndgamePositionForPosition(b)) {
        const savedEp = enPassantTarget;
        enPassantTarget = null;
        const R = 2;
        const nullScore = minimax(b, depth - 1 - R, alpha, beta, enemy, ply + 1, checkExt, false);
        enPassantTarget = savedEp;
        if (player === 'white' && nullScore >= beta) { searchLinePositions.pop(); return beta; }
        if (player === 'black' && nullScore <= alpha) { searchLinePositions.pop(); return alpha; }
    }

    const killers = (ply < MAX_PLY) ? killerMoves[ply] : null;
    moves.sort((a, b1) => {
        if (ttHitMove) {
            const aIsTT = a.from === ttHitMove.from && a.to === ttHitMove.to;
            const bIsTT = b1.from === ttHitMove.from && b1.to === ttHitMove.to;
            if (aIsTT && !bIsTT) return -1;
            if (bIsTT && !aIsTT) return 1;
        }
        return orderScore(b, b1, killers) - orderScore(b, a, killers);
    });

    const isMax = (player === 'white');
    const standPat = evaluatePositionForSearch(b, player, moveCount);
    let best = isFinite(standPat) ? standPat : 0;
    let anyMoveSearched = false;
    let bestMoveInLoop = null;

    for (let i = 0; i < moves.length; i++) {
        if (searchAborted) break;
        const move = moves[i];

        makeMoveOnBoard(b, move);
        anyMoveSearched = true;

        if (isSquareAttackedBy(b, kingSq[player], enemy)) {
            unmakeMoveOnBoard(b, move);
            continue;
        }

        const isQuiet = move.undo.captured === 0;

        let reduction = 0;
        if (isQuiet && depth >= 3 && i >= 3) reduction = 1;

        let score;
        if (i === 0) {
            score = minimax(b, depth - 1, alpha, beta, enemy, ply + 1, checkExt, true);
        } else {
            if (isMax) {
                score = minimax(b, depth - 1 - reduction, alpha, alpha + 1, enemy, ply + 1, checkExt, true);
                if (score > alpha && score < beta) {
                    score = minimax(b, depth - 1, alpha, beta, enemy, ply + 1, checkExt, true);
                }
            } else {
                score = minimax(b, depth - 1 - reduction, beta - 1, beta, enemy, ply + 1, checkExt, true);
                if (score < beta && score > alpha) {
                    score = minimax(b, depth - 1, alpha, beta, enemy, ply + 1, checkExt, true);
                }
            }
        }
        unmakeMoveOnBoard(b, move);

        if (!isFinite(score)) continue;

        if (isMax) {
            if (score > best) { best = score; bestMoveInLoop = move; }
            if (best > alpha) alpha = best;
            if (alpha >= beta) {
                if (isQuiet) storeKiller(ply, move);
                break;
            }
        } else {
            if (score < best) { best = score; bestMoveInLoop = move; }
            if (best < beta) beta = best;
            if (beta <= alpha) {
                if (isQuiet) storeKiller(ply, move);
                break;
            }
        }
    }

    searchLinePositions.pop();

    if (!anyMoveSearched) return standPat;
    const finalBest = isFinite(best) ? best : 0;

    if (USE_TT && ply > 0 && anyMoveSearched) {
        let flag;
        if (finalBest <= originalAlpha) flag = TT_UPPER;
        else if (finalBest >= beta) flag = TT_LOWER;
        else flag = TT_EXACT;
        ttStore(hashLo, hashHi, depth, adjustStoreScore(finalBest, ply), flag, bestMoveInLoop);
    }

    return finalBest;
}

function findBestMove() {
    searchStartTime = performance.now();

    let budgetMs = 8000;
    if (clockState.enabled) {
        const remaining = getRemainingMs(currentPlayer);
        const reserve = Math.max(500, clockState.incrementMs * 2);
        const usable = Math.max(50, remaining - reserve);
        budgetMs = Math.min(4000, Math.max(50, usable * 0.2));
    }
    searchDeadline = searchStartTime + budgetMs;
    extensionSoftDeadline = searchStartTime + Math.max(0, budgetMs - 500);

    searchAborted = false;
    nodesSearched = 0;
    searchLinePositions = [];
    resetKillerMoves();
    if (USE_TT) ttClear();

    rootEvalWhite = evaluatePositionForSearch(board, currentPlayer, moveCount);
    avoidRepetition = Math.abs(rootEvalWhite) > 150;

    for (const state of gameHistory) {
        searchLinePositions.push(boardToHash(state.boardCopy) + state.currentPlayerCopy[0]);
    }
    searchLinePositions.push(boardToHash(board) + currentPlayer[0]);

    const allMoves = getAllPossibleMovesForPosition(board, currentPlayer);
    if (allMoves.length === 0) return null;

    const isWinningSide = (currentPlayer === 'white' && rootEvalWhite > 200) ||
                          (currentPlayer === 'black' && rootEvalWhite < -200);
    const playerToMoveInResult = enemyColor(currentPlayer);
    let candidateMoves = allMoves;
    if (isWinningSide) {
        candidateMoves = [];
        for (const move of allMoves) {
            makeMoveOnBoard(board, move);
            const resultKey = boardToHash(board) + playerToMoveInResult[0];
            unmakeMoveOnBoard(board, move);
            const cnt = gamePositionCounts.get(resultKey) || 0;
            if (cnt < 2) {
                candidateMoves.push(move);
            } else {
                console.log(`⛔ Skipping ${toSAN(board, move, currentPlayer)} — would draw by repetition (count ${cnt})`);
            }
        }
        if (candidateMoves.length === 0) {
            candidateMoves = allMoves;
        }
    }

    for (const move of allMoves) {
        makeMoveOnBoard(board, move);
        const enemy = enemyColor(currentPlayer);
        if (isSquareAttackedBy(board, kingSq[enemy], currentPlayer)) {
            const responses = getAllPossibleMovesForPosition(board, enemy);
            if (responses.length === 0) {
                unmakeMoveOnBoard(board, move);
                console.log(`👑 Mate found: ${toSAN(board, move, currentPlayer)}`);
                return move;
            }
        }
        unmakeMoveOnBoard(board, move);
    }

    if (openingBook && uciHistory.length < 12) {
        const bookMove = openingBook.getOpeningRecommendation(uciHistory);
        if (bookMove) {
            const parsed = parseAlgebraicMove(bookMove);
            if (parsed) {
                const from = sqFromRC(parsed.fromRow, parsed.fromCol);
                const to = sqFromRC(parsed.toRow, parsed.toCol);
                for (const m of candidateMoves) {
                    if (m.from === from && m.to === to) {
                        console.log(`📖 Book: ${bookMove}`);
                        return m;
                    }
                }
            }
        }
    }

    // ============================================================
    // v2.7.5: Promotion-first move ordering at the root.
    // ============================================================
    candidateMoves.sort((a, b1) => {
        const aQueen = a.promo === 5 ? 1 : 0;
        const bQueen = b1.promo === 5 ? 1 : 0;
        if (aQueen !== bQueen) return bQueen - aQueen;
        const va = PIECE_VALUE_ARR[board[a.to]] || 0;
        const vb = PIECE_VALUE_ARR[board[b1.to]] || 0;
        return vb - va;
    });

    const isEndgame = isEndgamePositionForPosition(board);
    const baseMaxDepth = isEndgame ? SEARCH_CONFIG.endgameDepth : SEARCH_CONFIG.baseDepth;
    const absoluteMaxDepth = SEARCH_CONFIG.hardMaxDepth;

    let bestMove = candidateMoves[0];
    let bestEval = currentPlayer === 'white' ? -Infinity : Infinity;
    let lastDepth = 0;

    let prevScore = null;
    let prevMoveKey = null;
    let stableCount = 0;
    let extended = false;

    console.log(`🔍 ${currentPlayer.toUpperCase()} searching depth ${baseMaxDepth} (ext to ${absoluteMaxDepth}) budget ${budgetMs.toFixed(0)}ms${USE_TT ? ' [TT]' : ''}`);

    for (let depth = 1; depth <= absoluteMaxDepth; depth++) {
        if (searchAborted && depth > 1) break;

        let iterBestMove = null;
        let iterBestEval = currentPlayer === 'white' ? -Infinity : Infinity;
        const scores = new Map();

        let rootAlpha = -Infinity;
        let rootBeta = Infinity;

        for (const move of candidateMoves) {
            if (searchAborted) break;
            makeMoveOnBoard(board, move);
            const enemy = enemyColor(currentPlayer);
            if (isSquareAttackedBy(board, kingSq[currentPlayer], enemy)) {
                unmakeMoveOnBoard(board, move);
                continue;
            }
            const score = minimax(board, depth - 1, rootAlpha, rootBeta, enemy, 0, 0, true);
            unmakeMoveOnBoard(board, move);

            if (!isFinite(score)) continue;

            scores.set(move, score);

            console.log(`   root: ${toSAN(board, move, currentPlayer)} = ${score.toFixed(1)}`);

            if (currentPlayer === 'white') {
                if (score > iterBestEval) { iterBestMove = move; iterBestEval = score; }
                if (score > rootAlpha) rootAlpha = score;
            } else {
                if (score < iterBestEval) { iterBestMove = move; iterBestEval = score; }
                if (score < rootBeta) rootBeta = score;
            }
        }

        if (searchAborted && depth > 1) break;

        const isBaseDepth = depth <= baseMaxDepth;

        if (iterBestMove) {
            bestMove = iterBestMove;
            bestEval = iterBestEval;
            lastDepth = depth;
            candidateMoves.sort((a, b1) => {
                const sa = scores.get(a);
                const sb = scores.get(b1);
                if (sa === undefined && sb === undefined) return 0;
                if (sa === undefined) return 1;
                if (sb === undefined) return -1;
                return currentPlayer === 'white' ? sb - sa : sa - sb;
            });
        }

        if (!isBaseDepth && iterBestMove) {
            const newMoveKey = bestMove.from + ',' + bestMove.to;
            if (prevScore !== null && prevMoveKey !== null) {
                const delta = Math.abs(bestEval - prevScore);
                const moveChanged = newMoveKey !== prevMoveKey;
                if (delta < EXTENSION_SCORE_THRESHOLD && !moveChanged) {
                    stableCount++;
                    if (stableCount >= EXTENSION_STABLE_LIMIT) {
                        console.log(`   ✅ Converged at depth ${depth} (delta ${delta.toFixed(1)}, same move, stableCount ${stableCount})`);
                        break;
                    }
                } else {
                    stableCount = 0;
                }
            }
            if (performance.now() > extensionSoftDeadline) {
                console.log(`   ⏱️ Extension stopped at depth ${depth} (soft deadline)`);
                break;
            }
            extended = true;
        }

        prevScore = bestEval;
        prevMoveKey = bestMove ? (bestMove.from + ',' + bestMove.to) : null;
    }

    const elapsed = (performance.now() - searchStartTime).toFixed(0);
    const ttInfo = USE_TT
        ? ` | TT ${ttHits}/${ttProbes} hits (${(100 * ttHits / Math.max(1, ttProbes)).toFixed(1)}%), ${ttCutoffs} cutoffs, ${ttStores} stores`
        : '';
    console.log(`⏱️ ${elapsed}ms | ${toSAN(board, bestMove, currentPlayer)} | eval ${bestEval.toFixed(1)} | depth ${lastDepth}${extended ? ' (extended)' : ''} | ${nodesSearched} nodes${ttInfo}`);

    return bestMove;
}

function createBoard() {
    const boardElement = document.getElementById('chessboard');
    if (!boardElement) return;
    boardElement.innerHTML = '';

    const whiteInCheck = isSquareAttackedBy(board, kingSq.white, 'black');
    const blackInCheck = isSquareAttackedBy(board, kingSq.black, 'white');

    for (let row = 0; row < 8; row++) {
        for (let col = 0; col < 8; col++) {
            const square = document.createElement('div');
            square.className = 'square';
            square.id = `square-${row}-${col}`;
            if ((row + col) % 2 === 0) square.classList.add('light');
            else square.classList.add('dark');

            if (lastMove &&
                ((lastMove.fromRow === row && lastMove.fromCol === col) ||
                 (lastMove.toRow === row && lastMove.toCol === col))) {
                square.classList.add('last-move');
            }

            const piece = board[sqFromRC(row, col)];
            if ((piece === WK && whiteInCheck) || (piece === BK && blackInCheck)) {
                square.classList.add('in-check');
            }

            square.textContent = PIECE_CHAR[piece];
            square.onclick = () => handleSquareClick(row, col);
            boardElement.appendChild(square);
        }
    }
}

function handleSquareClick(row, col) {
    if (gameOver || isThinking) return;
    if (gameMode === 'ai' && currentPlayer !== humanPlayer) return;

    if (selectedSquare) {
        const fromRow = selectedSquare.row;
        const fromCol = selectedSquare.col;
        if (fromRow === row && fromCol === col) {
            clearSelection();
            return;
        }
        if (isValidMove(fromRow, fromCol, row, col)) {
            playMove(fromRow, fromCol, row, col);
            clearSelection();
            afterMove();
        } else {
            const piece = board[sqFromRC(row, col)];
            if (piece !== 0 && isPlayerPieceCode(piece, currentPlayer)) {
                selectSquare(row, col);
            } else {
                clearSelection();
            }
        }
    } else {
        const piece = board[sqFromRC(row, col)];
        if (piece !== 0 && isPlayerPieceCode(piece, currentPlayer)) {
            selectSquare(row, col);
        }
    }
}

function selectSquare(row, col) {
    clearSelection();
    selectedSquare = { row, col };
    const sq = document.getElementById(`square-${row}-${col}`);
    if (sq) sq.classList.add('selected');
    showPossibleMoves(row, col);
}

function clearSelection() {
    selectedSquare = null;
    document.querySelectorAll('.square').forEach(sq => {
        sq.classList.remove('selected', 'possible-move', 'capture-move');
    });
    createBoard();
}

function showPossibleMoves(row, col) {
    const from = sqFromRC(row, col);
    const legal = getAllPossibleMovesForPosition(board, currentPlayer);
    for (const m of legal) {
        if (m.from !== from) continue;
        const r = sqRow(m.to), c = sqCol(m.to);
        const el = document.getElementById(`square-${r}-${c}`);
        if (!el) continue;
        if (board[m.to] !== 0) el.classList.add('capture-move');
        else el.classList.add('possible-move');
    }
}

function playMove(fromRow, fromCol, toRow, toCol) {
    if (clockState.enabled && !gameOver && getRemainingMs(currentPlayer) <= 0) {
        gameOver = true;
        const winner = currentPlayer === 'white' ? 'Black' : 'White';
        const statusEl = document.getElementById('status');
        if (statusEl) {
            statusEl.textContent = `${winner} wins on time!`;
            statusEl.classList.add('checkmate');
        }
        updateClockDisplay();
        return;
    }

    const from = sqFromRC(fromRow, fromCol);
    const to = sqFromRC(toRow, toCol);

    const legal = getAllPossibleMovesForPosition(board, currentPlayer);
    let chosen = null;
    for (const m of legal) {
        if (m.from === from && m.to === to) { chosen = m; break; }
    }
    if (!chosen) return;

    gameHistory.push({
        boardCopy: new Int8Array(board),
        kingSqCopy: { ...kingSq },
        castlingCopy: { ...castlingRights },
        epCopy: enPassantTarget,
        halfMoveCopy: halfMoveCount,
        moveCountCopy: moveCount,
        currentPlayerCopy: currentPlayer,
        lastMoveCopy: lastMove
    });

    const san = toSAN(board, chosen, currentPlayer);

    makeMoveOnBoard(board, chosen);

    const mover = currentPlayer;
    commitClock();
    applyIncrement(mover);

    lastMove = { fromRow, fromCol, toRow, toCol };
    moveHistory.push(san);
    uciHistory.push(sqName(from) + sqName(to));

    if (currentPlayer === 'black') moveCount++;
    currentPlayer = enemyColor(currentPlayer);

    startClockFor(currentPlayer);

    const resultKey = boardToHash(board) + currentPlayer[0];
    gamePositionCounts.set(resultKey, (gamePositionCounts.get(resultKey) || 0) + 1);

    if (evalCache.size > 100000) evalCache.clear();

    updateMoveHistory();
    createBoard();
}

function updateMoveHistory() {
    const el = document.getElementById('move-list');
    if (!el) return;
    const parts = [];
    for (let i = 0; i < moveHistory.length; i += 2) {
        const n = Math.floor(i / 2) + 1;
        const w = moveHistory[i] || '';
        const b = moveHistory[i + 1] || '';
        parts.push(`${n}. ${w}${b ? ' ' + b : ''}`);
    }
    el.textContent = parts.join(' ') || 'Game ready to start';
}

function updateStatus() {
    const statusEl = document.getElementById('status');
    const playerEl = document.getElementById('current-player');
    const moveEl = document.getElementById('move-counter');
    if (!statusEl || !playerEl || !moveEl) return;

    const player = currentPlayer;
    const enemy = enemyColor(player);
    const inCheck = isSquareAttackedBy(board, kingSq[player], enemy);

    if (inCheck) {
        const moves = getAllPossibleMovesForPosition(board, player);
        if (moves.length === 0) {
            const winner = player === 'white' ? 'Black' : 'White';
            statusEl.textContent = `Checkmate! ${winner} wins!`;
            statusEl.classList.add('checkmate');
            gameOver = true;
        } else {
            statusEl.textContent = `${player.charAt(0).toUpperCase() + player.slice(1)} is in check!`;
            statusEl.classList.add('check');
        }
    } else {
        const moves = getAllPossibleMovesForPosition(board, player);
        if (moves.length === 0) {
            statusEl.textContent = 'Stalemate! Draw!';
            gameOver = true;
        } else if (halfMoveCount >= 100) {
            statusEl.textContent = 'Draw by 50-move rule';
            gameOver = true;
        } else {
            statusEl.textContent = `${player.charAt(0).toUpperCase() + player.slice(1)} to move`;
            statusEl.classList.remove('checkmate', 'check');
        }
    }

    playerEl.textContent = player.charAt(0).toUpperCase() + player.slice(1);
    moveEl.textContent = moveCount;
}

function afterMove() {
    updateStatus();
    if (gameOver) return;

    if (gameMode === 'ai' && currentPlayer === aiPlayer && !isThinking) {
        setTimeout(makeAIMove, 200);
    }
}

function makeAIMove() {
    if (isThinking || gameOver) return;
    if (currentPlayer !== aiPlayer) return;

    isThinking = true;
    const thinking = document.getElementById('thinking');
    const sync = document.getElementById('sync-status');
    if (thinking) thinking.style.display = 'block';
    if (sync) sync.textContent = `AI (${aiPlayer}) thinking...`;

    updateClockDisplay();

    setTimeout(() => {
        const move = findBestMove();
        isThinking = false;
        if (thinking) thinking.style.display = 'none';
        if (sync) sync.textContent = 'Ready';

        if (move && !gameOver) {
            playMove(sqRow(move.from), sqCol(move.from), sqRow(move.to), sqCol(move.to));
            afterMove();
        }
    }, 50);
}

function parseAlgebraicMove(str) {
    if (!str || str.length < 4) return null;
    const fromCol = str.charCodeAt(0) - 97;
    const fromRow = 8 - parseInt(str[1]);
    const toCol = str.charCodeAt(2) - 97;
    const toRow = 8 - parseInt(str[3]);
    if (fromRow < 0 || fromRow > 7 || fromCol < 0 || fromCol > 7) return null;
    if (toRow < 0 || toRow > 7 || toCol < 0 || toCol > 7) return null;
    return { fromRow, fromCol, toRow, toCol };
}

function newGame() {
    resetBoardToStart();
    currentPlayer = 'white';
    selectedSquare = null;
    gameHistory = [];
    moveHistory = [];
    uciHistory = [];
    gameOver = false;
    moveCount = 1;
    halfMoveCount = 0;
    lastMove = null;
    isThinking = false;
    castlingRights = { whiteKingside: true, whiteQueenside: true,
                       blackKingside: true, blackQueenside: true };
    enPassantTarget = null;
    evalCache.clear();
    if (USE_TT) ttClear();
    gamePositionCounts = new Map();
    gamePositionCounts.set(boardToHash(board) + 'w', 1);

    initClock(currentTimeControl);
    startClockFor('white');
    startClockTicker();

    createBoard();
    updateStatus();
    updateMoveHistory();

    const statusEl = document.getElementById('status');
    if (statusEl) statusEl.classList.remove('checkmate', 'check');

    if (gameMode === 'ai' && humanPlayer === 'black') {
        setTimeout(makeAIMove, 300);
    }
}

function undoMove() {
    if (gameHistory.length === 0) return;

    const currentKey = boardToHash(board) + currentPlayer[0];
    const cnt = gamePositionCounts.get(currentKey) || 1;
    if (cnt <= 1) gamePositionCounts.delete(currentKey);
    else gamePositionCounts.set(currentKey, cnt - 1);

    const prev = gameHistory.pop();
    board = prev.boardCopy;
    kingSq.white = prev.kingSqCopy.white;
    kingSq.black = prev.kingSqCopy.black;
    castlingRights = prev.castlingCopy;
    enPassantTarget = prev.epCopy;
    halfMoveCount = prev.halfMoveCopy;
    moveCount = prev.moveCountCopy;
    currentPlayer = prev.currentPlayerCopy;
    lastMove = prev.lastMoveCopy;
    moveHistory.pop();
    uciHistory.pop();
    gameOver = false;

    startClockFor(currentPlayer);

    createBoard();
    updateStatus();
    updateMoveHistory();
}

function switchSides() {
    humanPlayer = humanPlayer === 'white' ? 'black' : 'white';
    aiPlayer = enemyColor(humanPlayer);
    if (gameMode === 'ai' && currentPlayer === aiPlayer && !gameOver && !isThinking) {
        setTimeout(makeAIMove, 500);
    }
}

function changeGameMode() {
    const sel = document.getElementById('gameMode');
    const disp = document.getElementById('game-mode-display');
    if (!sel || !disp) return;
    gameMode = sel.value;
    if (gameMode === 'ai') {
        disp.textContent = `vs AI (v${GAME_VERSION})`;
        if (currentPlayer === aiPlayer && !gameOver && !isThinking) setTimeout(makeAIMove, 500);
    } else {
        disp.textContent = 'vs Player';
    }
}

function changeTimeControl() {
    const sel = document.getElementById('timeControl');
    if (!sel) return;
    const newControl = sel.value;
    console.log(`⏱️ Time control changed to: ${newControl}`);

    const tc = parseTimeControl(newControl);
    if (tc) {
        console.log(`   Base: ${tc.baseMs / 1000}s, Increment: ${tc.incrementMs / 1000}s`);
    } else {
        console.log(`   Unlimited`);
    }

    initClock(newControl);
    if (!gameOver) {
        startClockFor(currentPlayer);
        startClockTicker();
    }
}

function clearMemory() {
    if (confirm('Clear AI memory?')) {
        evalCache.clear();
        if (USE_TT) ttClear();
        alert('AI memory cleared!');
    }
}

window.addEventListener('load', function() {
    if (typeof ChessAILearner !== 'undefined') {
        enhancedAI = new ChessAILearner();
        openingBook = enhancedAI;
        console.log('📖 Opening Book loaded');
    }
    if (typeof GamePatternLearner !== 'undefined') {
        patternLearner = new GamePatternLearner();
    }
    if (typeof ChessEndgameEngine !== 'undefined') {
        endgameEngine = new ChessEndgameEngine();
        console.log('♟️ Endgame Engine loaded');
    }

    gamePositionCounts.set(boardToHash(board) + 'w', 1);

    const tcSel = document.getElementById('timeControl');
    currentTimeControl = tcSel ? tcSel.value : 'unlimited';

    initClock(currentTimeControl);
    startClockFor('white');
    startClockTicker();

    createBoard();
    updateStatus();
    updateMoveHistory();
    changeGameMode();

    console.log(`♔ Chess Game v${GAME_VERSION} Loaded! ♛`);
    console.log(`⚙️ TT: ${USE_TT ? 'ON' : 'OFF'} (${(1 << TT_BITS).toLocaleString()} entries)`);
});

if (typeof window !== 'undefined') {
    window.newGame = newGame;
    window.undoMove = undoMove;
    window.switchSides = switchSides;
    window.changeGameMode = changeGameMode;
    window.changeTimeControl = changeTimeControl;
    window.clearAIMemory = clearMemory;
}

console.log(`✅ Chess Game v${GAME_VERSION} loaded - deeper base, stricter convergence`);
