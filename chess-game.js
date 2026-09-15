// chess-game.js
// VERSION: 2.4.2 - Alpha-beta + tightened SEE pruning
// COMPATIBLE WITH: chess-ai-database.js (v2.0) and chess-game-database.js (v1.1)

const GAME_VERSION = "2.4.2";

let openingBook = null;
let patternLearner = null;

const evalCache = new Map();
const activityCache = new Map();
const threatCache = new Map();
const attackCache = new Map();
const reachableCache = new Map();
const kingDangerCache = new Map();
const promotionCache = new Map();
const mateCache = new Map();
const pawnShieldCache = new Map();
const hangingCache = new Map();

const CACHE_LIMIT = 500000;
let LAYER_HITS = 0;
let LAYER_MISSES = 0;
let currentSearchPrefix = "";

function setSearchPrefix(prefix) { currentSearchPrefix = prefix; }

function pruneCachesToLine(actualLine) {
    const linePrefix = actualLine.join("|");
    let pruned = 0;
    const caches = [evalCache, activityCache, threatCache, attackCache,
                    reachableCache, kingDangerCache, promotionCache, mateCache,
                    pawnShieldCache, hangingCache];
    for (const cache of caches) {
        const toDelete = [];
        for (const [key, entry] of cache) {
            const entryPrefix = entry.prefix || "";
            const keep = linePrefix.startsWith(entryPrefix) || entryPrefix.startsWith(linePrefix);
            if (!keep) toDelete.push(key);
        }
        for (const key of toDelete) cache.delete(key);
        pruned += toDelete.length;
    }
    console.log(`✂️ Pruned ${pruned} irrelevant cache entries`);
}

function clearAllCaches() {
    evalCache.clear(); activityCache.clear(); threatCache.clear(); attackCache.clear();
    reachableCache.clear(); kingDangerCache.clear(); promotionCache.clear(); mateCache.clear();
    pawnShieldCache.clear(); hangingCache.clear();
    LAYER_HITS = 0; LAYER_MISSES = 0; currentSearchPrefix = "";
}

function cacheGet(cache, key) {
    const entry = cache.get(key);
    if (entry === undefined) return undefined;
    const p = entry.prefix || "";
    const line = currentSearchPrefix;
    if (line.startsWith(p) || p.startsWith(line)) return entry.value;
    return undefined;
}

function cacheSet(cache, key, value) {
    if (cache.size > CACHE_LIMIT) cache.clear();
    cache.set(key, { value, prefix: currentSearchPrefix });
}

function boardToHash(boardState) {
    let hash = "";
    for (let row = 0; row < 8; row++)
        for (let col = 0; col < 8; col++)
            hash += boardState[row][col] || ".";
    return hash;
}

// ========== SEARCH HEURISTICS ==========
const killerMoves = Array.from({ length: 32 }, () => [null, null]);
const historyTable = new Map();

function resetSearchHeuristics() {
    for (let i = 0; i < 32; i++) { killerMoves[i][0] = null; killerMoves[i][1] = null; }
    historyTable.clear();
}

function recordKillerMove(depth, move) {
    if (depth >= 32 || depth < 0) return;
    const killers = killerMoves[depth];
    if (killers[0] && killers[0].fromRow === move.fromRow && killers[0].fromCol === move.fromCol &&
        killers[0].toRow === move.toRow && killers[0].toCol === move.toCol) return;
    killers[1] = killers[0];
    killers[0] = { fromRow: move.fromRow, fromCol: move.fromCol, toRow: move.toRow, toCol: move.toCol };
}

function recordHistory(move, depth) {
    const moveKey = `${move.fromRow},${move.fromCol},${move.toRow},${move.toCol}`;
    const current = historyTable.get(moveKey) || 0;
    historyTable.set(moveKey, current + depth * depth);
}

function scoreMoveForOrdering(boardState, move, player, depth) {
    const targetPiece = boardState[move.toRow][move.toCol];
    const moveKey = `${move.fromRow},${move.fromCol},${move.toRow},${move.toCol}`;
    if (targetPiece) {
        const see = evaluateCaptureSafety(boardState, move.fromRow, move.fromCol, move.toRow, move.toCol, player);
        return see > 0 ? 100000 + see : (see < 0 ? -100000 + see : 0);
    }
    if (depth >= 0 && depth < 32) {
        const killers = killerMoves[depth];
        for (let i = 0; i < killers.length; i++) {
            const killer = killers[i];
            if (killer && killer.fromRow === move.fromRow && killer.fromCol === move.fromCol &&
                killer.toRow === move.toRow && killer.toCol === move.toCol) return 90000 - i * 1000;
        }
    }
    return historyTable.get(moveKey) || 0;
}

// ========== PERSISTENT MEMORY TREE ==========
class PersistentMoveTree {
    constructor() {
        this.tree = new Map();
        this.positionCache = new Map();
        this.activeLineMoves = [];
        this.loadFromStorage();
    }
    getMoveKey(fr, fc, tr, tc) { return `${fr},${fc},${tr},${tc}`; }
    getPositionHash(b, p, c, e) {
        if (!b || !Array.isArray(b)) return "empty";
        let h = p + "|";
        for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) h += (b[r] && b[r][c]) || ".";
        h += "|" + JSON.stringify(c || {}) + "|" + (e ? `${e.row},${e.col}` : "null");
        return h;
    }
    storeMoveEvaluation(move, evaluation, depth, variations, isBestLine = false) {
        const key = this.getMoveKey(move.fromRow, move.fromCol, move.toRow, move.toCol);
        const currentBoard = typeof window !== 'undefined' && window.board ? window.board : null;
        const currentCastling = typeof window !== 'undefined' && window.castlingRights ? window.castlingRights : {};
        const currentEnPassant = typeof window !== 'undefined' && window.enPassantTarget ? window.enPassantTarget : null;
        const positionHash = this.getPositionHash(currentBoard, move.player || 'white', currentCastling, currentEnPassant);
        const node = { move, evaluation, depth, variations: variations || [], timestamp: Date.now(), positionHash, isBestLine,
            frequency: (this.tree.get(key)?.frequency || 0) + 1 };
        this.tree.set(key, node);
        if (positionHash !== "empty") this.positionCache.set(positionHash, node);
        this.saveToStorage();
        return node;
    }
    getCachedEvaluation(move, currentBoard, player, castling, enPassant) {
        const key = this.getMoveKey(move.fromRow, move.fromCol, move.toRow, move.toCol);
        const cached = this.tree.get(key);
        if (cached && currentBoard) {
            const currentHash = this.getPositionHash(currentBoard, player, castling, enPassant);
            if (cached.positionHash === currentHash) return cached;
        }
        return null;
    }
    pruneInactiveLines(currentMoveSequence) {
        if (!currentMoveSequence || currentMoveSequence.length === 0) return;
        const toDelete = [];
        for (const [key] of this.tree) {
            let shouldKeep = false;
            for (let i = 0; i <= currentMoveSequence.length; i++) {
                const linePrefix = currentMoveSequence.slice(0, i).join("|");
                if (key.startsWith(linePrefix) && key.split("|").length <= currentMoveSequence.length + 1) { shouldKeep = true; break; }
            }
            if (!shouldKeep) toDelete.push(key);
        }
        for (const key of toDelete) this.tree.delete(key);
        this.saveToStorage();
    }
    saveToStorage() {
        try {
            const data = { tree: Array.from(this.tree.entries()), positionCache: Array.from(this.positionCache.entries()),
                version: GAME_VERSION, lastUpdated: Date.now() };
            localStorage.setItem('chess_persistent_tree', JSON.stringify(data));
        } catch (e) {}
    }
    loadFromStorage() {
        try {
            const saved = localStorage.getItem('chess_persistent_tree');
            if (saved) {
                const data = JSON.parse(saved);
                if (data.version === GAME_VERSION) {
                    this.tree = new Map(data.tree);
                    this.positionCache = new Map(data.positionCache);
                }
            }
        } catch (e) {}
    }
    clear() { this.tree.clear(); this.positionCache.clear(); localStorage.removeItem('chess_persistent_tree'); }
    getStats() { return { totalMoves: this.tree.size, cachedPositions: this.positionCache.size, version: GAME_VERSION }; }
}

let moveTree = null;

let board = [
    ['♜', '♞', '♝', '♛', '♚', '♝', '♞', '♜'],
    ['♟', '♟', '♟', '♟', '♟', '♟', '♟', '♟'],
    ['', '', '', '', '', '', '', ''],
    ['', '', '', '', '', '', '', ''],
    ['', '', '', '', '', '', '', ''],
    ['', '', '', '', '', '', '', ''],
    ['♙', '♙', '♙', '♙', '♙', '♙', '♙', '♙'],
    ['♖', '♘', '♗', '♕', '♔', '♗', '♘', '♖']
];

let currentPlayer = 'white';
let selectedSquare = null;
let gameHistory = [];
let moveHistory = [];
let gameOver = false;
let gameMode = 'ai';
let humanPlayer = 'white';
let aiPlayer = 'black';
let moveCount = 1;
let halfMoveCount = 0;
let lastMove = null;
let isThinking = false;

let castlingRights = { whiteKingside: true, whiteQueenside: true, blackKingside: true, blackQueenside: true };
let enPassantTarget = null;
let enhancedAI = null;
let endgameEngine = null;

const pieceMap = { '♜': 'r', '♞': 'n', '♝': 'b', '♛': 'q', '♚': 'k', '♟': 'p',
    '♖': 'R', '♘': 'N', '♗': 'B', '♕': 'Q', '♔': 'K', '♙': 'P' };
const reversePieceMap = { 'r': '♜', 'n': '♞', 'b': '♝', 'q': '♛', 'k': '♚', 'p': '♟',
    'R': '♖', 'N': '♘', 'B': '♗', 'Q': '♕', 'K': '♔', 'P': '♙' };
const PIECE_VALUES = { '♙': 100, '♘': 320, '♗': 330, '♖': 500, '♕': 900, '♔': 20000,
    '♟': 100, '♞': 320, '♝': 330, '♜': 500, '♛': 900, '♚': 20000, '': 0 };

// ========== ENDGAME CHECK PREVENTION ==========
function isEndlessCheck(moveHistory, player) {
    if (moveHistory.length < 6) return false;
    let consecutiveChecks = 0, checksByPlayer = 0;
    for (let i = moveHistory.length - 1; i >= 0 && i >= moveHistory.length - 10; i--) {
        const move = moveHistory[i];
        if (move && (move.includes('+') || move.includes('#'))) {
            consecutiveChecks++;
            const moveIndex = i;
            const isPlayerMove = (moveIndex % 2 === 0 && player === 'white') || (moveIndex % 2 === 1 && player === 'black');
            if (isPlayerMove) checksByPlayer++;
        } else break;
    }
    return consecutiveChecks >= 3 && checksByPlayer >= 3;
}

function getEndgameCheckPenalty(boardState, player, moveHistory) {
    const isEndgame = isEndgamePositionForPosition(boardState);
    if (!isEndgame) return 0;
    if (isEndlessCheck(moveHistory, player)) return -250;
    let recentChecks = 0;
    for (let i = moveHistory.length - 1; i >= 0 && i >= moveHistory.length - 6; i--) {
        if (moveHistory[i] && (moveHistory[i].includes('+') || moveHistory[i].includes('#'))) recentChecks++;
    }
    if (recentChecks >= 4) return -150;
    if (recentChecks >= 3) return -80;
    return 0;
}

// ========== CHECKMATE PATTERN HEURISTICS ==========
function evaluateCheckmatePatterns(boardState, player) {
    const key = boardToHash(boardState) + "|mate|" + player;
    const cached = cacheGet(mateCache, key);
    if (cached !== undefined) { LAYER_HITS++; return cached; }
    LAYER_MISSES++;
    let mateScore = 0;
    const opponent = player === 'white' ? 'black' : 'white';
    const opponentKing = findKing(boardState, opponent);
    if (!opponentKing) { cacheSet(mateCache, key, 0); return 0; }
    const isKingInCorner = (opponentKing.row === 0 || opponentKing.row === 7) && (opponentKing.col === 0 || opponentKing.col === 7);
    if (isKingInCorner) mateScore += 30;
    const isKingOnEdge = opponentKing.row === 0 || opponentKing.row === 7 || opponentKing.col === 0 || opponentKing.col === 7;
    if (isKingOnEdge) mateScore += 15;
    let attackersNearKing = 0;
    for (let row = 0; row < 8; row++) for (let col = 0; col < 8; col++) {
        const piece = boardState[row] && boardState[row][col];
        if (piece && isPlayerPieceForPosition(piece, player)) {
            const distance = Math.abs(row - opponentKing.row) + Math.abs(col - opponentKing.col);
            if (distance <= 3 && piece !== '♔' && piece !== '♚') attackersNearKing++;
        }
    }
    mateScore += attackersNearKing * 20;
    let escapeSquares = 0;
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
        if (dr === 0 && dc === 0) continue;
        const newRow = opponentKing.row + dr, newCol = opponentKing.col + dc;
        if (newRow >= 0 && newRow < 8 && newCol >= 0 && newCol < 8) {
            const targetPiece = boardState[newRow] && boardState[newRow][newCol];
            if (!targetPiece || !isPlayerPieceForPosition(targetPiece, opponent)) {
                if (!isSquareAttackedForPosition(boardState, newRow, newCol, player)) escapeSquares++;
            }
        }
    }
    if (escapeSquares === 0) mateScore += 100;
    else if (escapeSquares <= 2) mateScore += 50;
    for (let row = 0; row < 8; row++) for (let col = 0; col < 8; col++) {
        const piece = boardState[row] && boardState[row][col];
        if (piece && ((player === 'white' && piece === '♕') || (player === 'black' && piece === '♛'))) {
            const distance = Math.abs(row - opponentKing.row) + Math.abs(col - opponentKing.col);
            if (distance <= 2) mateScore += 40;
        }
        if (piece && ((player === 'white' && piece === '♖') || (player === 'black' && piece === '♜'))) {
            if (row === opponentKing.row || col === opponentKing.col) mateScore += 25;
        }
    }
    cacheSet(mateCache, key, mateScore);
    return mateScore;
}

function findKing(boardState, player) {
    const kingSymbol = player === 'white' ? '♔' : '♚';
    for (let row = 0; row < 8; row++) for (let col = 0; col < 8; col++)
        if (boardState[row] && boardState[row][col] === kingSymbol) return { row, col };
    return null;
}

function isPieceDefended(boardState, row, col, player) {
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
        const piece = boardState[r] && boardState[r][c];
        if (piece && isPlayerPieceForPosition(piece, player)) {
            if (r === row && c === col) continue;
            if (canPieceAttackForPosition(piece, r, c, row, col, boardState)) return true;
        }
    }
    return false;
}

function isSquareAttackedByOpponent(boardState, row, col, player) {
    return isSquareAttackedForPosition(boardState, row, col, player === 'white' ? 'black' : 'white');
}

// ========== SEE ==========
function findCheapestAttacker(boardState, targetRow, targetCol, color) {
    let bestValue = Infinity, bestAttacker = null;
    for (let row = 0; row < 8; row++) for (let col = 0; col < 8; col++) {
        const piece = boardState[row] && boardState[row][col];
        if (!piece || !isPlayerPieceForPosition(piece, color)) continue;
        if (canPieceAttackForPosition(piece, row, col, targetRow, targetCol, boardState)) {
            const value = PIECE_VALUES[piece] || 0;
            if (value < bestValue) { bestValue = value; bestAttacker = { piece, row, col, value }; }
        }
    }
    return bestAttacker;
}

function seeRecursive(boardState, targetRow, targetCol, sideToMove) {
    const attacker = findCheapestAttacker(boardState, targetRow, targetCol, sideToMove);
    if (!attacker) return 0;
    const victim = boardState[targetRow][targetCol];
    const victimValue = victim ? (PIECE_VALUES[victim] || 0) : 0;
    const newBoard = makeTestMoveForPosition(boardState, attacker.row, attacker.col, targetRow, targetCol);
    if (!newBoard) return victimValue;
    const opponent = sideToMove === 'white' ? 'black' : 'white';
    const opponentBest = seeRecursive(newBoard, targetRow, targetCol, opponent);
    return Math.max(0, victimValue - opponentBest);
}

function evaluateCaptureSafety(boardState, fromRow, fromCol, toRow, toCol, player) {
    const victim = boardState[toRow][toCol];
    if (!victim) return 0;
    const victimValue = PIECE_VALUES[victim] || 0;
    const newBoard = makeTestMoveForPosition(boardState, fromRow, fromCol, toRow, toCol);
    if (!newBoard) return victimValue;
    const opponent = player === 'white' ? 'black' : 'white';
    const opponentBest = seeRecursive(newBoard, toRow, toCol, opponent);
    return victimValue - opponentBest;
}

function findLowestValueAttacker(boardState, targetRow, targetCol, attackerColor) {
    return findCheapestAttacker(boardState, targetRow, targetCol, attackerColor);
}

function getHungPieceValue(boardState, fromRow, fromCol, toRow, toCol, player) {
    const newBoard = makeTestMoveForPosition(boardState, fromRow, fromCol, toRow, toCol);
    if (!newBoard) return 0;
    const movedPiece = newBoard[toRow][toCol];
    if (movedPiece) {
        const movedValue = PIECE_VALUES[movedPiece] || 0;
        if (movedValue >= 300) {
            const attacked = isSquareAttackedByOpponent(newBoard, toRow, toCol, player);
            const defended = isPieceDefended(newBoard, toRow, toCol, player);
            if (attacked && !defended) return movedValue;
        }
    }
    let maxHungValue = 0;
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
        const p = newBoard[r] && newBoard[r][c];
        if (p && isPlayerPieceForPosition(p, player) && p !== '♔' && p !== '♚') {
            const val = PIECE_VALUES[p] || 0;
            if (val >= 300) {
                const attacked = isSquareAttackedByOpponent(newBoard, r, c, player);
                const defended = isPieceDefended(newBoard, r, c, player);
                if (attacked && !defended && val > maxHungValue) maxHungValue = val;
            }
        }
    }
    return maxHungValue;
}

// ========== PAWN SHIELD ==========
function evaluatePawnShield(boardState, player) {
    const key = boardToHash(boardState) + "|shield|" + player;
    const cached = cacheGet(pawnShieldCache, key);
    if (cached !== undefined) return cached;
    const king = findKing(boardState, player);
    if (!king) { cacheSet(pawnShieldCache, key, 0); return 0; }
    const pawn = player === 'white' ? '♙' : '♟';
    const direction = player === 'white' ? -1 : 1;
    const homeRow = player === 'white' ? 6 : 1;
    const shieldFiles = [king.col - 1, king.col, king.col + 1].filter(f => f >= 0 && f <= 7);
    let shieldScore = 0, pawnsInShield = 0;
    for (const file of shieldFiles) {
        let foundPawn = false;
        for (let r = king.row + direction; r >= 0 && r <= 7; r += direction) {
            if (boardState[r][file] === pawn) {
                foundPawn = true;
                shieldScore += 15 - Math.abs(r - homeRow) * 5;
                break;
            }
            if (boardState[r][file]) break;
        }
        if (foundPawn) pawnsInShield++;
    }
    if (pawnsInShield < shieldFiles.length) shieldScore -= (shieldFiles.length - pawnsInShield) * 25;
    cacheSet(pawnShieldCache, key, shieldScore);
    return shieldScore;
}

// ========== HANGING ==========
function evaluateHangingPieces(boardState, player) {
    const key = boardToHash(boardState) + "|hang|" + player;
    const cached = cacheGet(hangingCache, key);
    if (cached !== undefined) return cached;
    const opponent = player === 'white' ? 'black' : 'white';
    let hangingScore = 0;
    for (let row = 0; row < 8; row++) for (let col = 0; col < 8; col++) {
        const piece = boardState[row][col];
        if (!piece || !isPlayerPieceForPosition(piece, player)) continue;
        if (piece === '♔' || piece === '♚') continue;
        if (!isSquareAttackedForPosition(boardState, row, col, opponent)) continue;
        const pieceValue = PIECE_VALUES[piece] || 0;
        const defended = isPieceDefended(boardState, row, col, player);
        const attacker = findCheapestAttacker(boardState, row, col, opponent);
        if (!attacker) continue;
        if (!defended) hangingScore -= pieceValue;
        else if (attacker.value < pieceValue) hangingScore -= (pieceValue - attacker.value) * 0.5;
    }
    cacheSet(hangingCache, key, hangingScore);
    return hangingScore;
}

// ========== ACTIVITY ==========
function evaluateAllPieceActivity(boardState, player) {
    const key = boardToHash(boardState) + "|act|" + player;
    const cached = cacheGet(activityCache, key);
    if (cached !== undefined) { LAYER_HITS++; return cached; }
    LAYER_MISSES++;
    let totalActivity = 0;
    for (let row = 0; row < 8; row++) for (let col = 0; col < 8; col++) {
        const piece = boardState[row] && boardState[row][col];
        if (!piece || !isPlayerPieceForPosition(piece, player)) continue;
        if (piece === '♔' || piece === '♚') continue;
        totalActivity += evaluatePieceActivity(boardState, row, col, piece, player);
    }
    cacheSet(activityCache, key, totalActivity);
    return totalActivity;
}

function getReachableSquares(boardState, fromRow, fromCol, piece, player) {
    const key = boardToHash(boardState) + "|reach|" + fromRow + "," + fromCol;
    const cached = cacheGet(reachableCache, key);
    if (cached !== undefined) return cached;
    const squares = [];
    const pieceCode = pieceMap[piece];
    if (!pieceCode) return squares;
    const dirs = getPieceDirections(pieceCode);
    for (const [dx, dy] of dirs) {
        if (dirs.length > 0 && ['r', 'b', 'q'].includes(pieceCode.toLowerCase())) {
            let r = fromRow + dy, c = fromCol + dx;
            while (isInBounds(r, c)) {
                const target = boardState[r][c];
                if (!target) squares.push({ row: r, col: c });
                else { if (!isPlayerPieceForPosition(target, player)) squares.push({ row: r, col: c }); break; }
                r += dy; c += dx;
            }
        } else {
            const r = fromRow + dy, c = fromCol + dx;
            if (isInBounds(r, c)) {
                const target = boardState[r][c];
                if (!target || !isPlayerPieceForPosition(target, player)) squares.push({ row: r, col: c });
            }
        }
    }
    if (pieceCode.toLowerCase() === 'p') {
        const direction = pieceCode === 'P' ? -1 : 1;
        const startRow = pieceCode === 'P' ? 6 : 1;
        const oneForward = { row: fromRow + direction, col: fromCol };
        if (isInBounds(oneForward.row, oneForward.col) && !boardState[oneForward.row][oneForward.col]) {
            squares.push(oneForward);
            if (fromRow === startRow) {
                const twoForward = { row: fromRow + 2 * direction, col: fromCol };
                if (isInBounds(twoForward.row, twoForward.col) && !boardState[twoForward.row][twoForward.col]) squares.push(twoForward);
            }
        }
        for (const dc of [-1, 1]) {
            const capRow = fromRow + direction, capCol = fromCol + dc;
            if (isInBounds(capRow, capCol)) {
                const target = boardState[capRow][capCol];
                if (target && !isPlayerPieceForPosition(target, player)) squares.push({ row: capRow, col: capCol });
            }
        }
    }
    cacheSet(reachableCache, key, squares);
    return squares;
}

function getPieceDirections(pieceCode) {
    switch (pieceCode.toLowerCase()) {
        case 'r': return [[1, 0], [-1, 0], [0, 1], [0, -1]];
        case 'b': return [[1, 1], [1, -1], [-1, 1], [-1, -1]];
        case 'q': return [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
        case 'n': return [[1, 2], [2, 1], [-1, 2], [-2, 1], [1, -2], [2, -1], [-1, -2], [-2, -1]];
        case 'k': return [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
        default: return [];
    }
}

function isInBounds(row, col) { return row >= 0 && row < 8 && col >= 0 && col < 8; }

function evaluatePieceActivity(boardState, row, col, piece, player) {
    const pieceValue = PIECE_VALUES[piece] || 0;
    const opponent = player === 'white' ? 'black' : 'white';
    const pieceCode = pieceMap[piece].toLowerCase();
    const reachableSquares = getReachableSquares(boardState, row, col, piece, player);
    if (reachableSquares.length === 0) return -pieceValue * 0.3;
    let activityScore = 0;
    activityScore += reachableSquares.length * getMobilityWeight(pieceCode);
    for (const sq of reachableSquares) {
        const target = boardState[sq.row][sq.col];
        if (target && isPlayerPieceForPosition(target, opponent)) {
            const targetValue = PIECE_VALUES[target] || 0;
            activityScore += targetValue * 0.15;
            if (!isPieceDefended(boardState, sq.row, sq.col, opponent)) activityScore += targetValue * 0.25;
        } else if (!target) {
            activityScore += evaluateSquareControlValue(sq.row, sq.col, player);
        }
    }
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
        const friendlyPiece = boardState[r][c];
        if (!friendlyPiece || !isPlayerPieceForPosition(friendlyPiece, player)) continue;
        if (r === row && c === col) continue;
        if (isSquareAttackedForPosition(boardState, r, c, opponent)) {
            if (canPieceAttackForPosition(piece, row, col, r, c, boardState)) {
                activityScore += (PIECE_VALUES[friendlyPiece] || 0) * 0.1;
            }
        }
    }
    if (isSquareAttackedForPosition(boardState, row, col, opponent)) {
        if (!isPieceDefended(boardState, row, col, player)) activityScore -= pieceValue * 0.4;
        else activityScore -= pieceValue * 0.05;
    }
    if (['r', 'b', 'q'].includes(pieceCode)) activityScore += evaluateOpenLines(boardState, row, col, pieceCode);
    if (isOnStartingSquare(row, col, piece)) activityScore -= 15;
    return activityScore;
}

function getMobilityWeight(pieceCode) {
    switch (pieceCode) {
        case 'n': return 8; case 'b': return 6; case 'r': return 4; case 'q': return 3; case 'k': return 1;
        default: return 5;
    }
}

function evaluateSquareControlValue(row, col, player) {
    let value = Math.max(0, 7 - (Math.abs(row - 3.5) + Math.abs(col - 3.5)) * 1.5);
    if (player === 'white') value += (7 - row) * 0.5;
    else value += row * 0.5;
    return value;
}

function evaluateOpenLines(boardState, row, col, pieceCode) {
    let bonus = 0;
    for (const [dx, dy] of getPieceDirections(pieceCode)) {
        let r = row + dy, c = col + dx, steps = 0;
        while (isInBounds(r, c)) { if (boardState[r][c]) break; steps++; r += dy; c += dx; }
        bonus += steps * 1.5;
    }
    return bonus;
}

function isOnStartingSquare(row, col, piece) {
    if (piece === '♖') return row === 7 && (col === 0 || col === 7);
    if (piece === '♘') return row === 7 && (col === 1 || col === 6);
    if (piece === '♗') return row === 7 && (col === 2 || col === 5);
    if (piece === '♕') return row === 7 && col === 3;
    if (piece === '♜') return row === 0 && (col === 0 || col === 7);
    if (piece === '♞') return row === 0 && (col === 1 || col === 6);
    if (piece === '♝') return row === 0 && (col === 2 || col === 5);
    if (piece === '♛') return row === 0 && col === 3;
    return false;
}

// ========== THREATS ==========
function scoreMoveThreat(boardState, move, attacker, defender) {
    const piece = boardState[move.fromRow][move.fromCol];
    const target = boardState[move.toRow][move.toCol];
    let threat = 0;
    if (target) {
        const victimValue = PIECE_VALUES[target] || 0;
        const attackerValue = PIECE_VALUES[piece] || 0;
        const targetDefended = isPieceDefended(boardState, move.toRow, move.toCol, defender);
        if (!targetDefended) threat += victimValue;
        else threat += Math.max(0, victimValue - attackerValue) * 0.5;
    }
    const newBoard = makeTestMoveForPosition(boardState, move.fromRow, move.fromCol, move.toRow, move.toCol);
    if (newBoard && isKingInCheckForPosition(newBoard, defender)) {
        threat += 150;
        if (getAllPossibleMovesForPosition(newBoard, defender).length === 0) threat += 100000;
    }
    if ((piece === '♟' && move.toRow === 7) || (piece === '♙' && move.toRow === 0)) threat += 900;
    if (piece === '♟' && move.toRow === 6) threat += 200;
    if (piece === '♙' && move.toRow === 1) threat += 200;
    return threat;
}

function evaluateOpponentThreats(boardState, player) {
    const key = boardToHash(boardState) + "|thr|" + player;
    const cached = cacheGet(threatCache, key);
    if (cached !== undefined) { LAYER_HITS++; return cached; }
    LAYER_MISSES++;
    const opponent = player === 'white' ? 'black' : 'white';
    const opponentMoves = getAllPossibleMovesForPosition(boardState, opponent);
    let maxThreat = 0, totalThreat = 0;
    for (const move of opponentMoves) {
        const threat = scoreMoveThreat(boardState, move, opponent, player);
        totalThreat += threat;
        if (threat > maxThreat) maxThreat = threat;
    }
    const result = maxThreat * 2 + totalThreat * 0.3;
    cacheSet(threatCache, key, result);
    return result;
}

function evaluateKingDanger(boardState, player) {
    const key = boardToHash(boardState) + "|king|" + player;
    const cached = cacheGet(kingDangerCache, key);
    if (cached !== undefined) return cached;
    const king = findKing(boardState, player);
    if (!king) { cacheSet(kingDangerCache, key, 0); return 0; }
    let danger = 0;
    const opponent = player === 'white' ? 'black' : 'white';
    for (let row = 0; row < 8; row++) for (let col = 0; col < 8; col++) {
        const piece = boardState[row] && boardState[row][col];
        if (piece && isPlayerPieceForPosition(piece, opponent)) {
            const distance = Math.abs(row - king.row) + Math.abs(col - king.col);
            if (distance <= 2 && piece !== '♚' && piece !== '♔') danger += 30;
        }
    }
    if (isKingInCheckForPosition(boardState, player)) danger += 200;
    if (king.col >= 2 && king.col <= 5 && king.row >= 2 && king.row <= 5) danger += 50;
    let escapeSquares = 0;
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
        if (dr === 0 && dc === 0) continue;
        const r = king.row + dr, c = king.col + dc;
        if (r >= 0 && r < 8 && c >= 0 && c < 8) {
            const occupant = boardState[r][c];
            if (!occupant || !isPlayerPieceForPosition(occupant, player)) {
                if (!isSquareAttackedForPosition(boardState, r, c, opponent)) escapeSquares++;
            }
        }
    }
    if (escapeSquares === 0) danger += 300;
    else if (escapeSquares === 1) danger += 100;
    cacheSet(kingDangerCache, key, danger);
    return danger;
}

function evaluatePromotionThreats(boardState, player) {
    const key = boardToHash(boardState) + "|prom|" + player;
    const cached = cacheGet(promotionCache, key);
    if (cached !== undefined) return cached;
    let score = 0;
    for (let row = 0; row < 8; row++) for (let col = 0; col < 8; col++) {
        const piece = boardState[row][col];
        if (!piece) continue;
        if (piece === '♙' && player === 'white') {
            if (row === 1) score += 400; else if (row === 2) score += 200;
            else if (row === 3) score += 80; else if (row === 4) score += 30;
        }
        if (piece === '♟' && player === 'black') {
            if (row === 6) score += 400; else if (row === 5) score += 200;
            else if (row === 4) score += 80; else if (row === 3) score += 30;
        }
    }
    cacheSet(promotionCache, key, score);
    return score;
}

// ========== MAIN EVALUATION ==========
function evaluatePositionForSearch(boardState, player, moveNumber) {
    if (!boardState) return 0;
    const key = boardToHash(boardState) + "|eval|" + player;
    const cached = cacheGet(evalCache, key);
    if (cached !== undefined) { LAYER_HITS++; return cached; }
    LAYER_MISSES++;
    let evaluation = 0;
    const opponent = player === 'white' ? 'black' : 'white';
    for (let row = 0; row < 8; row++) for (let col = 0; col < 8; col++) {
        const piece = boardState[row] && boardState[row][col];
        if (piece) {
            const value = PIECE_VALUES[piece] || 0;
            evaluation += isPlayerPieceForPosition(piece, 'white') ? value : -value;
        }
    }
    evaluation += evaluateAllPieceActivity(boardState, 'white');
    evaluation -= evaluateAllPieceActivity(boardState, 'black');
    evaluation -= evaluateOpponentThreats(boardState, player) * 0.5;
    evaluation -= evaluateKingDanger(boardState, player) * 0.5;
    evaluation += evaluateKingDanger(boardState, opponent) * 0.5;
    evaluation += evaluatePawnShield(boardState, player);
    evaluation -= evaluatePawnShield(boardState, opponent);
    evaluation += evaluateHangingPieces(boardState, player);
    evaluation -= evaluateHangingPieces(boardState, opponent);
    evaluation += evaluatePromotionThreats(boardState, player);
    evaluation -= evaluatePromotionThreats(boardState, opponent);
    evaluation += getEndgameCheckPenalty(boardState, player, moveHistory);
    evaluation += evaluateCheckmatePatterns(boardState, player);
    cacheSet(evalCache, key, evaluation);
    return evaluation;
}

// ========== HELPERS ==========
function isPlayerPieceForPosition(piece, player) {
    if (!piece) return false;
    const whitePieces = ['♔', '♕', '♖', '♗', '♘', '♙'];
    const blackPieces = ['♚', '♛', '♜', '♝', '♞', '♟'];
    return player === 'white' ? whitePieces.includes(piece) : blackPieces.includes(piece);
}
function isPlayerPiece(piece, player) { return isPlayerPieceForPosition(piece, player); }

function isPathClearForPosition(boardState, fromRow, fromCol, toRow, toCol) {
    if (!boardState) return false;
    const dx = Math.sign(toCol - fromCol), dy = Math.sign(toRow - fromRow);
    let currentRow = fromRow + dy, currentCol = fromCol + dx;
    while (currentRow !== toRow || currentCol !== toCol) {
        if (boardState[currentRow] && boardState[currentRow][currentCol]) return false;
        currentRow += dy; currentCol += dx;
    }
    return true;
}

function canPieceAttackForPosition(piece, fromRow, fromCol, toRow, toCol, boardState) {
    const pieceCode = pieceMap[piece];
    if (!pieceCode) return false;
    const dx = toCol - fromCol, dy = toRow - fromRow;
    const absDx = Math.abs(dx), absDy = Math.abs(dy);
    switch (pieceCode.toLowerCase()) {
        case 'p': return absDx === 1 && dy === (pieceCode === 'P' ? -1 : 1);
        case 'r': return (dx === 0 || dy === 0) && isPathClearForPosition(boardState, fromRow, fromCol, toRow, toCol);
        case 'n': return (absDx === 2 && absDy === 1) || (absDx === 1 && absDy === 2);
        case 'b': return absDx === absDy && isPathClearForPosition(boardState, fromRow, fromCol, toRow, toCol);
        case 'q': return (dx === 0 || dy === 0 || absDx === absDy) && isPathClearForPosition(boardState, fromRow, fromCol, toRow, toCol);
        case 'k': return absDx <= 1 && absDy <= 1;
        default: return false;
    }
}

function isSquareAttackedForPosition(boardState, targetRow, targetCol, attackerColor) {
    if (!boardState) return false;
    const key = boardToHash(boardState) + "|atk|" + targetRow + "," + targetCol + "|" + attackerColor;
    const cached = cacheGet(attackCache, key);
    if (cached !== undefined) return cached;
    let result = false;
    for (let row = 0; row < 8 && !result; row++) for (let col = 0; col < 8 && !result; col++) {
        const attacker = boardState[row] && boardState[row][col];
        if (attacker && isPlayerPieceForPosition(attacker, attackerColor)) {
            if (canPieceAttackForPosition(attacker, row, col, targetRow, targetCol, boardState)) result = true;
        }
    }
    cacheSet(attackCache, key, result);
    return result;
}

function isKingInCheckForPosition(boardState, player) {
    if (!boardState) return false;
    const kingSymbol = player === 'white' ? '♔' : '♚';
    let kingRow = -1, kingCol = -1;
    for (let row = 0; row < 8; row++) {
        for (let col = 0; col < 8; col++) {
            if (boardState[row] && boardState[row][col] === kingSymbol) { kingRow = row; kingCol = col; break; }
        }
        if (kingRow !== -1) break;
    }
    if (kingRow === -1) return false;
    return isSquareAttackedForPosition(boardState, kingRow, kingCol, player === 'white' ? 'black' : 'white');
}

function isValidMoveForPosition(boardState, fromRow, fromCol, toRow, toCol, player) {
    if (!boardState) return false;
    if (toRow < 0 || toRow > 7 || toCol < 0 || toCol > 7) return false;
    const piece = boardState[fromRow] && boardState[fromRow][fromCol];
    const targetPiece = boardState[toRow] && boardState[toRow][toCol];
    if (!piece) return false;
    if (targetPiece && isPlayerPieceForPosition(targetPiece, player)) return false;
    const pieceCode = pieceMap[piece];
    if (!pieceCode) return false;
    const dx = toCol - fromCol, dy = toRow - fromRow;
    const absDx = Math.abs(dx), absDy = Math.abs(dy);
    let valid = false;
    switch (pieceCode.toLowerCase()) {
        case 'p': {
            const direction = pieceCode === 'P' ? -1 : 1;
            const startRow = pieceCode === 'P' ? 6 : 1;
            if (dx === 0) {
                if (dy === direction && !boardState[toRow][toCol]) valid = true;
                if (fromRow === startRow && dy === 2 * direction && !boardState[toRow][toCol]) {
                    const intermediateRow = fromRow + direction;
                    if (!boardState[intermediateRow][fromCol]) valid = true;
                }
            } else if (absDx === 1 && dy === direction && boardState[toRow][toCol]) valid = true;
            break;
        }
        case 'r': valid = (dx === 0 || dy === 0) && isPathClearForPosition(boardState, fromRow, fromCol, toRow, toCol); break;
        case 'n': valid = (absDx === 2 && absDy === 1) || (absDx === 1 && absDy === 2); break;
        case 'b': valid = absDx === absDy && isPathClearForPosition(boardState, fromRow, fromCol, toRow, toCol); break;
        case 'q': valid = (dx === 0 || dy === 0 || absDx === absDy) && isPathClearForPosition(boardState, fromRow, fromCol, toRow, toCol); break;
        case 'k': valid = absDx <= 1 && absDy <= 1; break;
    }
    if (!valid) return false;
    const newBoard = makeTestMoveForPosition(boardState, fromRow, fromCol, toRow, toCol);
    return !isKingInCheckForPosition(newBoard, player);
}

function makeTestMoveForPosition(boardState, fromRow, fromCol, toRow, toCol) {
    if (!boardState) return null;
    const newBoard = boardState.map(row => row ? [...row] : []);
    const piece = newBoard[fromRow] && newBoard[fromRow][fromCol];
    if (newBoard[toRow] && piece) {
        newBoard[toRow][toCol] = piece;
        newBoard[fromRow][fromCol] = '';
    }
    return newBoard;
}

function getAllPossibleMovesForPosition(boardState, player) {
    if (!boardState) return [];
    const moves = [];
    for (let fromRow = 0; fromRow < 8; fromRow++) for (let fromCol = 0; fromCol < 8; fromCol++) {
        const piece = boardState[fromRow] && boardState[fromRow][fromCol];
        if (piece && isPlayerPieceForPosition(piece, player)) {
            for (let toRow = 0; toRow < 8; toRow++) for (let toCol = 0; toCol < 8; toCol++) {
                if (isValidMoveForPosition(boardState, fromRow, fromCol, toRow, toCol, player)) {
                    moves.push({ fromRow, fromCol, toRow, toCol });
                }
            }
        }
    }
    return moves;
}

function isEndgamePositionForPosition(boardState) {
    if (!boardState) return false;
    let pieceCount = 0;
    for (let row = 0; row < 8; row++) for (let col = 0; col < 8; col++) {
        const piece = boardState[row] && boardState[row][col];
        if (piece && piece !== '♔' && piece !== '♚') pieceCount++;
    }
    return pieceCount <= 10;
}

// ========== MINIMAX WITH ALPHA-BETA + TIGHTENED SEE PRUNING ==========

const SEARCH_CONFIG = {
    baseDepth: 3,
    endgameDepth: 5,
    useMemory: true,
    quiescenceDepth: 2       // reduced from 4 — big speed win
};

let transpositionTable = new Map();

function quiescenceSearch(boardState, alpha, beta, player, qDepth) {
    const moves = getAllPossibleMovesForPosition(boardState, player);
    if (moves.length === 0) {
        if (isKingInCheckForPosition(boardState, player)) return -20000;
        return 0;
    }
    if (qDepth <= 0) return evaluatePositionForSearch(boardState, player, moveCount);
    
    let standPat = evaluatePositionForSearch(boardState, player, moveCount);
    if (standPat >= beta) return beta;
    if (alpha < standPat) alpha = standPat;
    
    const inCheck = isKingInCheckForPosition(boardState, player);
    const candidateMoves = inCheck ? moves : moves.filter(m => boardState[m.toRow][m.toCol] !== '');
    
    candidateMoves.sort((a, b) => {
        const victimA = PIECE_VALUES[boardState[a.toRow][a.toCol]] || 0;
        const victimB = PIECE_VALUES[boardState[b.toRow][b.toCol]] || 0;
        const attackerA = PIECE_VALUES[boardState[a.fromRow][a.fromCol]] || 0;
        const attackerB = PIECE_VALUES[boardState[b.fromRow][b.fromCol]] || 0;
        return (victimB - attackerB) - (victimA - attackerA);
    });
    
    const opponent = player === 'white' ? 'black' : 'white';
    
    for (const move of candidateMoves) {
        // Skip captures with SEE < 0 (winning or equal captures only)
        if (!inCheck) {
            const seeScore = evaluateCaptureSafety(boardState, move.fromRow, move.fromCol, move.toRow, move.toCol, player);
            if (seeScore < 0) continue;
        }
        const newBoard = makeTestMoveForPosition(boardState, move.fromRow, move.fromCol, move.toRow, move.toCol);
        const score = -quiescenceSearch(newBoard, -beta, -alpha, opponent, qDepth - 1);
        if (score >= beta) return beta;
        if (score > alpha) alpha = score;
    }
    return alpha;
}

function minimaxWithRisk(boardState, depth, alpha, beta, isMaximizingPlayer, player, moveNumber, trackWorstCase = false) {
    if (!boardState) return 0;
    
    const moves = getAllPossibleMovesForPosition(boardState, player);
    
    // Mate/stalemate detection at any depth
    if (moves.length === 0) {
        if (isKingInCheckForPosition(boardState, player)) {
            return isMaximizingPlayer ? (-20000 - depth) : (20000 + depth);
        }
        return 0;
    }
    
    const inCheck = isKingInCheckForPosition(boardState, player);
    
    if (depth <= 0 && !inCheck) {
        return quiescenceSearch(boardState, alpha, beta, player, SEARCH_CONFIG.quiescenceDepth);
    }
    if (depth <= 0 && inCheck) depth = 1;
    
    // Order moves
    moves.sort((a, b) => scoreMoveForOrdering(boardState, b, player, depth) - scoreMoveForOrdering(boardState, a, player, depth));

    if (isMaximizingPlayer) {
        let maxEval = -Infinity;
        let worstCaseEval = Infinity;
        const nextPlayer = player === 'white' ? 'black' : 'white';

        for (const move of moves) {
            const targetPiece = boardState[move.toRow][move.toCol];
            
            // SEE pruning: skip losing captures at ALL depths
            if (targetPiece) {
                const newBoardTest = makeTestMoveForPosition(boardState, move.fromRow, move.fromCol, move.toRow, move.toCol);
                const givesCheck = newBoardTest && isKingInCheckForPosition(newBoardTest, nextPlayer);
                if (!givesCheck) {
                    const see = evaluateCaptureSafety(boardState, move.fromRow, move.fromCol, move.toRow, move.toCol, player);
                    if (see < 0) continue;
                }
            }
            
            const newBoard = makeTestMoveForPosition(boardState, move.fromRow, move.fromCol, move.toRow, move.toCol);
            const evaluation = minimaxWithRisk(newBoard, depth - 1, alpha, beta, false, nextPlayer, moveNumber + 1, trackWorstCase);
            let evalValue = typeof evaluation === 'object' ? evaluation.best : evaluation;
            
            if (targetPiece) {
                const captureSafety = evaluateCaptureSafety(boardState, move.fromRow, move.fromCol, move.toRow, move.toCol, player);
                evalValue += captureSafety;
            }
            
            maxEval = Math.max(maxEval, evalValue);
            if (trackWorstCase) {
                const worstVal = typeof evaluation === 'object' ? evaluation.worst : evaluation;
                worstCaseEval = Math.min(worstCaseEval, worstVal);
            }
            alpha = Math.max(alpha, evalValue);
            if (beta <= alpha) {
                if (!targetPiece) {
                    recordKillerMove(depth, move);
                    recordHistory(move, depth);
                }
                break;
            }
        }
        return trackWorstCase ? { best: maxEval, worst: worstCaseEval } : maxEval;
    } else {
        let minEval = Infinity;
        let worstCaseEval = -Infinity;
        const nextPlayer = player === 'white' ? 'black' : 'white';

        for (const move of moves) {
            const targetPiece = boardState[move.toRow][move.toCol];
            
            // SEE pruning at ALL depths
            if (targetPiece) {
                const newBoardTest = makeTestMoveForPosition(boardState, move.fromRow, move.fromCol, move.toRow, move.toCol);
                const givesCheck = newBoardTest && isKingInCheckForPosition(newBoardTest, nextPlayer);
                if (!givesCheck) {
                    const see = evaluateCaptureSafety(boardState, move.fromRow, move.fromCol, move.toRow, move.toCol, player);
                    if (see < 0) continue;
                }
            }
            
            const newBoard = makeTestMoveForPosition(boardState, move.fromRow, move.fromCol, move.toRow, move.toCol);
            const evaluation = minimaxWithRisk(newBoard, depth - 1, alpha, beta, true, nextPlayer, moveNumber + 1, trackWorstCase);
            let evalValue = typeof evaluation === 'object' ? evaluation.best : evaluation;
            
            if (targetPiece) {
                const captureSafety = evaluateCaptureSafety(boardState, move.fromRow, move.fromCol, move.toRow, move.toCol, player);
                evalValue -= captureSafety;
            }
            
            minEval = Math.min(minEval, evalValue);
            if (trackWorstCase) {
                const worstVal = typeof evaluation === 'object' ? evaluation.worst : evaluation;
                worstCaseEval = Math.max(worstCaseEval, worstVal);
            }
            beta = Math.min(beta, evalValue);
            if (beta <= alpha) {
                if (!targetPiece) {
                    recordKillerMove(depth, move);
                    recordHistory(move, depth);
                }
                break;
            }
        }
        return trackWorstCase ? { best: minEval, worst: worstCaseEval } : minEval;
    }
}

// ========== RISK ASSESSMENT ==========
class RiskAssessment {
    constructor() { this.riskThreshold = 300; }
    assessLineRisk(lineEvaluations) {
        const risks = [];
        for (const line of lineEvaluations) {
            const riskScore = this.calculateRiskScore(line);
            risks.push({ ...line, riskScore, isSafe: riskScore < this.riskThreshold });
        }
        return risks;
    }
    calculateRiskScore(line) {
        const potentialLoss = Math.abs(line.worstCase - line.bestCase);
        const depthWeight = Math.min(line.depth / 10, 1);
        return potentialLoss * depthWeight;
    }
    findBestSafeMove(riskAssessedLines) {
        const safeLines = riskAssessedLines.filter(line => line.isSafe);
        if (safeLines.length === 0) {
            riskAssessedLines.sort((a, b) => b.bestCase - a.bestCase);
            return riskAssessedLines[0];
        }
        safeLines.sort((a, b) => b.bestCase - a.bestCase);
        return safeLines[0];
    }
}

let riskAssessor = new RiskAssessment();

// ========== SEARCH ENTRY WITH ROOT ALPHA-BETA ==========

function findBestMoveWithRiskAssessment() {
    setSearchPrefix(moveHistory.join("|"));
    resetSearchHeuristics();
    
    const allMoves = getAllPossibleMoves(currentPlayer);
    if (allMoves.length === 0) return null;
    
    const opponentColor = currentPlayer === 'white' ? 'black' : 'white';
    
    // ROOT MATE SAFETY NET
    for (const move of allMoves) {
        const newBoard = makeTestMoveForPosition(board, move.fromRow, move.fromCol, move.toRow, move.toCol);
        if (newBoard && isKingInCheckForPosition(newBoard, opponentColor)) {
            const opponentMoves = getAllPossibleMovesForPosition(newBoard, opponentColor);
            if (opponentMoves.length === 0) {
                console.log(`👑 Immediate mate found: ${toAlgebraicMove(move.fromRow, move.fromCol, move.toRow, move.toCol)}`);
                return move;
            }
        }
    }
    
    if (openingBook && moveHistory.length < 12) {
        const openingMoveAlgebraic = openingBook.getOpeningRecommendation(moveHistory);
        if (openingMoveAlgebraic) {
            const openingMove = parseAlgebraicMove(openingMoveAlgebraic);
            if (openingMove && isValidMove(openingMove.fromRow, openingMove.fromCol, openingMove.toRow, openingMove.toCol)) {
                console.log(`📖 Opening book: Playing ${openingMoveAlgebraic}`);
                return openingMove;
            }
        }
    }
    
    const isEndgame = isEndgamePositionForPosition(board);
    const searchDepth = isEndgame ? SEARCH_CONFIG.endgameDepth : SEARCH_CONFIG.baseDepth;
    
    console.log(`🔍 ${currentPlayer.toUpperCase()} AI searching at depth ${searchDepth}${isEndgame ? ' (endgame)' : ''}`);
    const searchStartTime = performance.now();
    
    allMoves.sort((a, b) => {
        const targetA = board[a.toRow][a.toCol];
        const targetB = board[b.toRow][b.toCol];
        if (targetA && !targetB) return -1;
        if (!targetA && targetB) return 1;
        if (targetA && targetB) {
            const seeA = evaluateCaptureSafety(board, a.fromRow, a.fromCol, a.toRow, a.toCol, currentPlayer);
            const seeB = evaluateCaptureSafety(board, b.fromRow, b.fromCol, b.toRow, b.toCol, currentPlayer);
            return seeB - seeA;
        }
        return 0;
    });
    
    const evaluatedMoves = [];
    
    // Track alpha across root moves for beta-cutoff at root level.
    // AI maximizes, so alpha starts very low and only goes up.
    let rootAlpha = -Infinity;
    
    for (const move of allMoves) {
        if (isEndgame) {
            const testHistory = [...moveHistory, toAlgebraicMove(move.fromRow, move.fromCol, move.toRow, move.toCol)];
            if (isEndlessCheck(testHistory, currentPlayer)) continue;
        }
        
        let cachedResult = null;
        if (moveTree && SEARCH_CONFIG.useMemory) {
            cachedResult = moveTree.getCachedEvaluation(move, board, currentPlayer, castlingRights, enPassantTarget);
        }
        
        if (cachedResult) {
            evaluatedMoves.push({
                move,
                bestCase: cachedResult.evaluation,
                worstCase: cachedResult.evaluation - 100,
                depth: cachedResult.depth
            });
        } else {
            const newBoard = makeTestMoveForPosition(board, move.fromRow, move.fromCol, move.toRow, move.toCol);
            
            // Root alpha-beta: pass rootAlpha as the alpha value so subtrees prune
            const bestResult = minimaxWithRisk(newBoard, searchDepth - 1, rootAlpha, Infinity, false, 
                opponentColor, moveCount + 1, false);
            const worstResult = minimaxWithRisk(newBoard, searchDepth - 1, -Infinity, Infinity, false, 
                opponentColor, moveCount + 1, true);
            
            const worstCase = typeof worstResult === 'object' ? worstResult.best : worstResult;
            let bestCase = typeof bestResult === 'object' ? bestResult.best : bestResult;
            
            const targetPiece = board[move.toRow][move.toCol];
            if (targetPiece) {
                const captureSafety = evaluateCaptureSafety(board, move.fromRow, move.fromCol, move.toRow, move.toCol, currentPlayer);
                bestCase += captureSafety;
            }
            
            evaluatedMoves.push({ move, bestCase, worstCase, depth: searchDepth });
            
            // Update root alpha so later sibling subtrees prune harder
            if (bestCase > rootAlpha) rootAlpha = bestCase;
            
            if (moveTree && SEARCH_CONFIG.useMemory) {
                moveTree.storeMoveEvaluation(move, bestCase, searchDepth, [{ worst: worstCase }]);
            }
        }
    }
    
    if (evaluatedMoves.length === 0) {
        for (const move of allMoves) {
            const newBoard = makeTestMoveForPosition(board, move.fromRow, move.fromCol, move.toRow, move.toCol);
            const bestResult = minimaxWithRisk(newBoard, searchDepth - 1, -Infinity, Infinity, false, 
                opponentColor, moveCount + 1, false);
            const bestCase = typeof bestResult === 'object' ? bestResult.best : bestResult;
            evaluatedMoves.push({ move, bestCase, worstCase: bestCase - 100, depth: searchDepth });
        }
    }
    
    if (currentPlayer === 'black') {
        evaluatedMoves.sort((a, b) => a.bestCase - b.bestCase);
    } else {
        evaluatedMoves.sort((a, b) => b.bestCase - a.bestCase);
    }
    
    const riskAssessed = riskAssessor.assessLineRisk(evaluatedMoves);
    
    let bestSafeMove;
    if (currentPlayer === 'black') {
        bestSafeMove = riskAssessed.reduce((best, current) => 
            current.bestCase < best.bestCase ? current : best, riskAssessed[0]);
    } else {
        bestSafeMove = riskAssessor.findBestSafeMove(riskAssessed);
    }
    
    const searchTime = (performance.now() - searchStartTime).toFixed(0);
    const moveStr = toAlgebraicMove(bestSafeMove.move.fromRow, bestSafeMove.move.fromCol, bestSafeMove.move.toRow, bestSafeMove.move.toCol);
    console.log(`⏱️ ${searchTime}ms | Selected: ${moveStr} | Eval: ${bestSafeMove.bestCase} | Cache: ${LAYER_HITS}h/${LAYER_MISSES}m`);
    
    return bestSafeMove.move;
}

function findBestMove() { return findBestMoveWithRiskAssessment(); }

// [Rest of file: game functions, UI, init — unchanged from your version]
// Copy from your existing file starting at "// ========== CORE GAME FUNCTIONS =========="

console.log(`✅ Chess Game v${GAME_VERSION} loaded - Alpha-beta + tightened pruning`);
