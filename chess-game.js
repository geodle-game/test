// chess-game.js
// Enhanced chess game with Persistent Memory Tree Search (PMTS) and Risk Assessment
// VERSION: 2.4.1 - Fixed Endless Checks + Checkmate Knowledge + Database Learning
// COMPATIBLE WITH: chess-ai-database.js (v2.0) and chess-game-database.js (v1.1)

const GAME_VERSION = "2.4.1";

// ========== GAME DATABASES ==========
let openingBook = null;        // From chess-ai-database.js (opening moves)
let patternLearner = null;     // From chess-game-database.js (patterns from full games)

// ========== PERSISTENT MEMORY TREE SYSTEM ==========
class PersistentMoveTree {
    constructor() {
        this.tree = new Map();
        this.positionCache = new Map();
        this.currentLineHash = null;
        this.activeLineMoves = [];
        this.loadFromStorage();
    }

    getMoveKey(fromRow, fromCol, toRow, toCol) {
        return `${fromRow},${fromCol},${toRow},${toCol}`;
    }

    getPositionHash(board, player, castling, enPassant) {
        if (!board || !Array.isArray(board)) return "empty";
        
        let hash = player + "|";
        for (let row = 0; row < 8; row++) {
            for (let col = 0; col < 8; col++) {
                hash += (board[row] && board[row][col]) || ".";
            }
        }
        hash += "|" + JSON.stringify(castling || {}) + "|" + (enPassant ? `${enPassant.row},${enPassant.col}` : "null");
        return hash;
    }

    storeMoveEvaluation(move, evaluation, depth, variations, isBestLine = false) {
        const key = this.getMoveKey(move.fromRow, move.fromCol, move.toRow, move.toCol);
        
        const currentBoard = typeof window !== 'undefined' && window.board ? window.board : null;
        const currentCastling = typeof window !== 'undefined' && window.castlingRights ? window.castlingRights : {};
        const currentEnPassant = typeof window !== 'undefined' && window.enPassantTarget ? window.enPassantTarget : null;
        
        const positionHash = this.getPositionHash(currentBoard, move.player || 'white', currentCastling, currentEnPassant);
        
        const node = {
            move,
            evaluation,
            depth,
            variations: variations || [],
            timestamp: Date.now(),
            positionHash,
            isBestLine,
            frequency: (this.tree.get(key)?.frequency || 0) + 1
        };
        
        this.tree.set(key, node);
        if (positionHash !== "empty") {
            this.positionCache.set(positionHash, node);
        }
        this.saveToStorage();
        
        return node;
    }

    getCachedEvaluation(move, currentBoard, player, castling, enPassant) {
        const key = this.getMoveKey(move.fromRow, move.fromCol, move.toRow, move.toCol);
        const cached = this.tree.get(key);
        
        if (cached && currentBoard) {
            const currentHash = this.getPositionHash(currentBoard, player, castling, enPassant);
            if (cached.positionHash === currentHash) {
                return cached;
            }
        }
        return null;
    }

    pruneInactiveLines(currentMoveSequence) {
        if (!currentMoveSequence || currentMoveSequence.length === 0) return;
        
        const toDelete = [];
        
        for (const [key, node] of this.tree) {
            let shouldKeep = false;
            
            for (let i = 0; i <= currentMoveSequence.length; i++) {
                const linePrefix = currentMoveSequence.slice(0, i).join("|");
                if (key.startsWith(linePrefix) && key.split("|").length <= currentMoveSequence.length + 1) {
                    shouldKeep = true;
                    break;
                }
            }
            
            if (!shouldKeep) {
                toDelete.push(key);
            }
        }
        
        for (const key of toDelete) {
            this.tree.delete(key);
        }
        
        if (toDelete.length > 0) {
            console.log(`✂️ Pruned ${toDelete.length} inactive lines`);
        }
        this.saveToStorage();
    }

    extendLine(currentMoveSequence, newVariations) {
        const extendedMoves = [];
        
        for (const variation of newVariations) {
            const fullSequence = [...currentMoveSequence, variation.moveKey];
            extendedMoves.push({
                moveKey: variation.moveKey,
                fullSequence,
                evaluation: variation.evaluation
            });
        }
        
        if (extendedMoves.length > 0) {
            console.log(`🔍 Extended current line by ${extendedMoves.length} new variations`);
        }
        return extendedMoves;
    }

    saveToStorage() {
        try {
            const data = {
                tree: Array.from(this.tree.entries()),
                positionCache: Array.from(this.positionCache.entries()),
                version: GAME_VERSION,
                lastUpdated: Date.now()
            };
            localStorage.setItem('chess_persistent_tree', JSON.stringify(data));
        } catch (e) {
            console.warn("Could not save to localStorage:", e);
        }
    }

    loadFromStorage() {
        try {
            const saved = localStorage.getItem('chess_persistent_tree');
            if (saved) {
                const data = JSON.parse(saved);
                if (data.version === GAME_VERSION) {
                    this.tree = new Map(data.tree);
                    this.positionCache = new Map(data.positionCache);
                    console.log(`📀 Loaded ${this.tree.size} moves from persistent memory`);
                }
            }
        } catch (e) {
            console.log("No saved memory found, starting fresh");
        }
    }

    clear() {
        this.tree.clear();
        this.positionCache.clear();
        localStorage.removeItem('chess_persistent_tree');
        console.log("🗑️ Cleared persistent memory");
    }

    getStats() {
        return {
            totalMoves: this.tree.size,
            cachedPositions: this.positionCache.size,
            version: GAME_VERSION
        };
    }
}

let moveTree = null;

// Chess board representation
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

let castlingRights = {
    whiteKingside: true,
    whiteQueenside: true,
    blackKingside: true,
    blackQueenside: true
};

let enPassantTarget = null;
let enhancedAI = null;
let endgameEngine = null;

// Piece mappings
const pieceMap = {
    '♜': 'r', '♞': 'n', '♝': 'b', '♛': 'q', '♚': 'k', '♟': 'p',
    '♖': 'R', '♘': 'N', '♗': 'B', '♕': 'Q', '♔': 'K', '♙': 'P'
};

const reversePieceMap = {
    'r': '♜', 'n': '♞', 'b': '♝', 'q': '♛', 'k': '♚', 'p': '♟',
    'R': '♖', 'N': '♘', 'B': '♗', 'Q': '♕', 'K': '♔', 'P': '♙'
};

const PIECE_VALUES = {
    '♙': 100, '♘': 320, '♗': 330, '♖': 500, '♕': 900, '♔': 20000,
    '♟': 100, '♞': 320, '♝': 330, '♜': 500, '♛': 900, '♚': 20000,
    '': 0
};

const PIECE_SQUARE_TABLES = {
    '♙': [
        [0, 0, 0, 0, 0, 0, 0, 0],
        [50, 50, 50, 50, 50, 50, 50, 50],
        [10, 10, 20, 30, 30, 20, 10, 10],
        [5, 5, 10, 25, 25, 10, 5, 5],
        [0, 0, 0, 20, 20, 0, 0, 0],
        [5, -5, -10, 0, 0, -10, -5, 5],
        [5, 10, 10, -20, -20, 10, 10, 5],
        [0, 0, 0, 0, 0, 0, 0, 0]
    ],
    '♘': [
        [-50, -40, -30, -30, -30, -30, -40, -50],
        [-40, -20, 0, 0, 0, 0, -20, -40],
        [-30, 0, 10, 15, 15, 10, 0, -30],
        [-30, 5, 15, 20, 20, 15, 5, -30],
        [-30, 0, 15, 20, 20, 15, 0, -30],
        [-30, 5, 10, 15, 15, 10, 5, -30],
        [-40, -20, 0, 5, 5, 0, -20, -40],
        [-50, -40, -30, -30, -30, -30, -40, -50]
    ],
    '♗': [
        [-20, -10, -10, -10, -10, -10, -10, -20],
        [-10, 0, 0, 0, 0, 0, 0, -10],
        [-10, 0, 5, 10, 10, 5, 0, -10],
        [-10, 5, 5, 10, 10, 5, 5, -10],
        [-10, 0, 10, 10, 10, 10, 0, -10],
        [-10, 10, 10, 10, 10, 10, 10, -10],
        [-10, 5, 0, 0, 0, 0, 5, -10],
        [-20, -10, -10, -10, -10, -10, -10, -20]
    ],
    '♖': [
        [0, 0, 0, 0, 0, 0, 0, 0],
        [5, 10, 10, 10, 10, 10, 10, 5],
        [-5, 0, 0, 0, 0, 0, 0, -5],
        [-5, 0, 0, 0, 0, 0, 0, -5],
        [-5, 0, 0, 0, 0, 0, 0, -5],
        [-5, 0, 0, 0, 0, 0, 0, -5],
        [-5, 0, 0, 0, 0, 0, 0, -5],
        [0, 0, 0, 5, 5, 0, 0, 0]
    ],
    '♕': [
        [-20, -10, -10, -5, -5, -10, -10, -20],
        [-10, 0, 0, 0, 0, 0, 0, -10],
        [-10, 0, 5, 5, 5, 5, 0, -10],
        [-5, 0, 5, 5, 5, 5, 0, -5],
        [0, 0, 5, 5, 5, 5, 0, -5],
        [-10, 5, 5, 5, 5, 5, 0, -10],
        [-10, 0, 5, 0, 0, 0, 0, -10],
        [-20, -10, -10, -5, -5, -10, -10, -20]
    ],
    '♔': [
        [-30, -40, -40, -50, -50, -40, -40, -30],
        [-30, -40, -40, -50, -50, -40, -40, -30],
        [-30, -40, -40, -50, -50, -40, -40, -30],
        [-30, -40, -40, -50, -50, -40, -40, -30],
        [-20, -30, -30, -40, -40, -30, -30, -20],
        [-10, -20, -20, -20, -20, -20, -20, -10],
        [20, 20, 0, 0, 0, 0, 20, 20],
        [20, 30, 10, 0, 0, 10, 30, 20]
    ]
};

const BLACK_PIECE_SQUARE_TABLES = {
    '♟': [
        [0, 0, 0, 0, 0, 0, 0, 0],
        [5, 10, 10, -20, -20, 10, 10, 5],
        [5, -5, -10, 0, 0, -10, -5, 5],
        [0, 0, 0, 20, 20, 0, 0, 0],
        [5, 5, 10, 25, 25, 10, 5, 5],
        [10, 10, 20, 30, 30, 20, 10, 10],
        [50, 50, 50, 50, 50, 50, 50, 50],
        [0, 0, 0, 0, 0, 0, 0, 0]
    ],
    '♞': [
        [-50, -40, -30, -30, -30, -30, -40, -50],
        [-40, -20, 0, 5, 5, 0, -20, -40],
        [-30, 5, 10, 15, 15, 10, 5, -30],
        [-30, 0, 15, 20, 20, 15, 0, -30],
        [-30, 5, 15, 20, 20, 15, 5, -30],
        [-30, 0, 10, 15, 15, 10, 0, -30],
        [-40, -20, 0, 0, 0, 0, -20, -40],
        [-50, -40, -30, -30, -30, -30, -40, -50]
    ],
    '♝': [
        [-20, -10, -10, -10, -10, -10, -10, -20],
        [-10, 5, 0, 0, 0, 0, 5, -10],
        [-10, 10, 10, 10, 10, 10, 10, -10],
        [-10, 0, 10, 10, 10, 10, 0, -10],
        [-10, 5, 5, 10, 10, 5, 5, -10],
        [-10, 0, 5, 10, 10, 5, 0, -10],
        [-10, 0, 0, 0, 0, 0, 0, -10],
        [-20, -10, -10, -10, -10, -10, -10, -20]
    ],
    '♜': [
        [0, 0, 0, 5, 5, 0, 0, 0],
        [-5, 0, 0, 0, 0, 0, 0, -5],
        [-5, 0, 0, 0, 0, 0, 0, -5],
        [-5, 0, 0, 0, 0, 0, 0, -5],
        [-5, 0, 0, 0, 0, 0, 0, -5],
        [-5, 0, 0, 0, 0, 0, 0, -5],
        [5, 10, 10, 10, 10, 10, 10, 5],
        [0, 0, 0, 0, 0, 0, 0, 0]
    ],
    '♛': [
        [-20, -10, -10, -5, -5, -10, -10, -20],
        [-10, 0, 5, 0, 0, 0, 0, -10],
        [-10, 5, 5, 5, 5, 5, 0, -10],
        [0, 0, 5, 5, 5, 5, 0, -5],
        [-5, 0, 5, 5, 5, 5, 0, -5],
        [-10, 0, 5, 5, 5, 5, 0, -10],
        [-10, 0, 0, 0, 0, 0, 0, -10],
        [-20, -10, -10, -5, -5, -10, -10, -20]
    ],
    '♚': [
        [20, 30, 10, 0, 0, 10, 30, 20],
        [20, 20, 0, 0, 0, 0, 20, 20],
        [-10, -20, -20, -20, -20, -20, -20, -10],
        [-20, -30, -30, -40, -40, -30, -30, -20],
        [-30, -40, -40, -50, -50, -40, -40, -30],
        [-30, -40, -40, -50, -50, -40, -40, -30],
        [-30, -40, -40, -50, -50, -40, -40, -30],
        [-30, -40, -40, -50, -50, -40, -40, -30]
    ]
};

const ENDGAME_PIECE_SQUARE_TABLES = {
    '♔': [
        [-50, -40, -30, -20, -20, -30, -40, -50],
        [-30, -20, -10, 0, 0, -10, -20, -30],
        [-30, -10, 20, 30, 30, 20, -10, -30],
        [-30, -10, 30, 40, 40, 30, -10, -30],
        [-30, -10, 30, 40, 40, 30, -10, -30],
        [-30, -10, 20, 30, 30, 20, -10, -30],
        [-30, -30, 0, 0, 0, 0, -30, -30],
        [-50, -30, -30, -30, -30, -30, -30, -50]
    ],
    '♚': [
        [-50, -30, -30, -30, -30, -30, -30, -50],
        [-30, -30, 0, 0, 0, 0, -30, -30],
        [-30, -10, 20, 30, 30, 20, -10, -30],
        [-30, -10, 30, 40, 40, 30, -10, -30],
        [-30, -10, 30, 40, 40, 30, -10, -30],
        [-30, -10, 20, 30, 30, 20, -10, -30],
        [-30, -20, -10, 0, 0, -10, -20, -30],
        [-50, -40, -30, -20, -20, -30, -40, -50]
    ]
};

// ========== ENDGAME CHECK PREVENTION ==========

function isEndlessCheck(moveHistory, player) {
    if (moveHistory.length < 6) return false;
    
    let consecutiveChecks = 0;
    let checksByPlayer = 0;
    
    for (let i = moveHistory.length - 1; i >= 0 && i >= moveHistory.length - 10; i--) {
        const move = moveHistory[i];
        if (move && (move.includes('+') || move.includes('#'))) {
            consecutiveChecks++;
            const moveIndex = i;
            const isPlayerMove = (moveIndex % 2 === 0 && player === 'white') || 
                               (moveIndex % 2 === 1 && player === 'black');
            if (isPlayerMove) checksByPlayer++;
        } else {
            break;
        }
    }
    
    return consecutiveChecks >= 3 && checksByPlayer >= 3;
}

function getEndgameCheckPenalty(boardState, player, moveHistory) {
    const isEndgame = isEndgamePositionForPosition(boardState);
    if (!isEndgame) return 0;
    
    if (isEndlessCheck(moveHistory, player)) {
        return -250;
    }
    
    let recentChecks = 0;
    for (let i = moveHistory.length - 1; i >= 0 && i >= moveHistory.length - 6; i--) {
        if (moveHistory[i] && (moveHistory[i].includes('+') || moveHistory[i].includes('#'))) {
            recentChecks++;
        }
    }
    
    if (recentChecks >= 4) {
        return -150;
    } else if (recentChecks >= 3) {
        return -80;
    }
    
    return 0;
}

// ========== CHECKMATE KNOWLEDGE ==========

function evaluateCheckmatePatterns(boardState, player) {
    let mateScore = 0;
    const opponent = player === 'white' ? 'black' : 'white';
    const opponentKing = findKing(boardState, opponent);
    
    if (!opponentKing) return 0;
    
    // King in corner is easier to checkmate
    const isKingInCorner = (opponentKing.row === 0 || opponentKing.row === 7) && 
                           (opponentKing.col === 0 || opponentKing.col === 7);
    if (isKingInCorner) {
        mateScore += 30;
    }
    
    // King on edge is good for attacking
    const isKingOnEdge = opponentKing.row === 0 || opponentKing.row === 7 || 
                         opponentKing.col === 0 || opponentKing.col === 7;
    if (isKingOnEdge) {
        mateScore += 15;
    }
    
    // Count attacking pieces near enemy king
    let attackersNearKing = 0;
    for (let row = 0; row < 8; row++) {
        for (let col = 0; col < 8; col++) {
            const piece = boardState[row] && boardState[row][col];
            if (piece && isPlayerPieceForPosition(piece, player)) {
                const distance = Math.abs(row - opponentKing.row) + Math.abs(col - opponentKing.col);
                if (distance <= 3 && piece !== '♔' && piece !== '♚') {
                    attackersNearKing++;
                }
            }
        }
    }
    mateScore += attackersNearKing * 20;
    
    // Enemy king has no escape squares (checkmate pattern)
    let escapeSquares = 0;
    for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
            if (dr === 0 && dc === 0) continue;
            const newRow = opponentKing.row + dr;
            const newCol = opponentKing.col + dc;
            if (newRow >= 0 && newRow < 8 && newCol >= 0 && newCol < 8) {
                const targetPiece = boardState[newRow] && boardState[newRow][newCol];
                if (!targetPiece || !isPlayerPieceForPosition(targetPiece, opponent)) {
                    if (!isSquareAttackedForPosition(boardState, newRow, newCol, player)) {
                        escapeSquares++;
                    }
                }
            }
        }
    }
    
    // Fewer escape squares = closer to checkmate
    if (escapeSquares === 0) {
        mateScore += 100;
    } else if (escapeSquares <= 2) {
        mateScore += 50;
    }
    
    // Bonus for having queen near enemy king (common checkmate pattern)
    for (let row = 0; row < 8; row++) {
        for (let col = 0; col < 8; col++) {
            const piece = boardState[row] && boardState[row][col];
            if (piece && ((player === 'white' && piece === '♕') || (player === 'black' && piece === '♛'))) {
                const distance = Math.abs(row - opponentKing.row) + Math.abs(col - opponentKing.col);
                if (distance <= 2) {
                    mateScore += 40;
                }
            }
        }
    }
    
    // Rook on the same file/rank as enemy king (back rank mate pattern)
    for (let row = 0; row < 8; row++) {
        for (let col = 0; col < 8; col++) {
            const piece = boardState[row] && boardState[row][col];
            if (piece && ((player === 'white' && piece === '♖') || (player === 'black' && piece === '♜'))) {
                if (row === opponentKing.row || col === opponentKing.col) {
                    mateScore += 25;
                }
            }
        }
    }
    
    return mateScore;
}

function findKing(boardState, player) {
    const kingSymbol = player === 'white' ? '♔' : '♚';
    for (let row = 0; row < 8; row++) {
        for (let col = 0; col < 8; col++) {
            if (boardState[row] && boardState[row][col] === kingSymbol) {
                return { row, col };
            }
        }
    }
    return null;
}

// ========== SMART TACTICAL AWARENESS ==========

function isPieceDefended(boardState, row, col, player) {
    for (let r = 0; r < 8; r++) {
        for (let c = 0; c < 8; c++) {
            const piece = boardState[r] && boardState[r][c];
            if (piece && isPlayerPieceForPosition(piece, player)) {
                if (canPieceAttackForPosition(piece, r, c, row, col, boardState)) {
                    return true;
                }
            }
        }
    }
    return false;
}

function isSquareAttackedByOpponent(boardState, row, col, player) {
    const opponent = player === 'white' ? 'black' : 'white';
    return isSquareAttackedForPosition(boardState, row, col, opponent);
}

function evaluateCaptureSafety(boardState, fromRow, fromCol, toRow, toCol, player) {
    const attacker = boardState[fromRow][fromCol];
    const victim = boardState[toRow][toCol];
    
    if (!victim) return 0;
    
    const attackerValue = PIECE_VALUES[attacker] || 0;
    const victimValue = PIECE_VALUES[victim] || 0;
    
    const newBoard = makeTestMoveForPosition(boardState, fromRow, fromCol, toRow, toCol);
    if (!newBoard) return 0;
    
    const canBeRecaptured = isSquareAttackedByOpponent(newBoard, toRow, toCol, player);
    const isDefendedAfterCapture = isPieceDefended(newBoard, toRow, toCol, player);
    
    if (canBeRecaptured && !isDefendedAfterCapture) {
        const netChange = victimValue - attackerValue;
        if (netChange < 0) {
            return netChange * 2;
        }
        if (netChange === 0) {
            return -30;
        }
    }
    
    if (victimValue > attackerValue && (!canBeRecaptured || isDefendedAfterCapture)) {
        return (victimValue - attackerValue) * 0.5;
    }
    
    return 0;
}

function wouldHangPiece(boardState, fromRow, fromCol, toRow, toCol, player) {
    const newBoard = makeTestMoveForPosition(boardState, fromRow, fromCol, toRow, toCol);
    if (!newBoard) return false;
    
    const piece = boardState[fromRow][fromCol];
    const pieceValue = PIECE_VALUES[piece] || 0;
    
    if (pieceValue <= 100) return false;
    
    for (let r = 0; r < 8; r++) {
        for (let c = 0; c < 8; c++) {
            const p = newBoard[r] && newBoard[r][c];
            if (p && isPlayerPieceForPosition(p, player) && p !== '♔' && p !== '♚') {
                const val = PIECE_VALUES[p] || 0;
                if (val >= 300) {
                    const attacked = isSquareAttackedByOpponent(newBoard, r, c, player);
                    const defended = isPieceDefended(newBoard, r, c, player);
                    
                    if (attacked && !defended) {
                        return true;
                    }
                }
            }
        }
    }
    
    return false;
}

// ========== CONSOLE COMMANDS ==========

window.displayBoard = function() {
    console.log("\n  a b c d e f g h");
    for (let row = 0; row < 8; row++) {
        let line = (8 - row) + " ";
        for (let col = 0; col < 8; col++) {
            const piece = board[row][col];
            line += (piece || ".") + " ";
        }
        console.log(line);
    }
    console.log(`\nCurrent player: ${currentPlayer}`);
    console.log(`Game over: ${gameOver}`);
    if (isKingInCheck(board, currentPlayer)) {
        console.log(`⚠️ ${currentPlayer} is in check!`);
    }
    return "Board displayed above";
};

window.setFEN = function(fen) {
    try {
        const parts = fen.split(' ');
        const boardPart = parts[0];
        const rows = boardPart.split('/');
        
        if (rows.length !== 8) {
            console.error("Invalid FEN: Wrong number of rows");
            return false;
        }
        
        const newBoard = [];
        for (let i = 0; i < 8; i++) {
            const row = rows[i];
            const newRow = [];
            let col = 0;
            for (let j = 0; j < row.length; j++) {
                const char = row[j];
                if (isNaN(parseInt(char))) {
                    newRow.push(reversePieceMap[char] || '');
                    col++;
                } else {
                    const emptyCount = parseInt(char);
                    for (let k = 0; k < emptyCount; k++) {
                        newRow.push('');
                        col++;
                    }
                }
            }
            newBoard.push(newRow);
        }
        
        board = newBoard;
        
        if (parts.length > 1) {
            currentPlayer = parts[1] === 'w' ? 'white' : 'black';
        }
        
        if (parts.length > 2 && parts[2] !== '-') {
            castlingRights = {
                whiteKingside: parts[2].includes('K'),
                whiteQueenside: parts[2].includes('Q'),
                blackKingside: parts[2].includes('k'),
                blackQueenside: parts[2].includes('q')
            };
        }
        
        if (parts.length > 3 && parts[3] !== '-') {
            const file = parts[3][0];
            const rank = parts[3][1];
            enPassantTarget = {
                row: 8 - parseInt(rank),
                col: file.charCodeAt(0) - 97
            };
        } else {
            enPassantTarget = null;
        }
        
        gameOver = false;
        selectedSquare = null;
        
        createBoard();
        updateStatus();
        console.log("✅ Position set successfully!");
        window.displayBoard();
        return "Position set successfully";
    } catch (error) {
        console.error("Error parsing FEN:", error);
        return false;
    }
};

window.getFEN = function() {
    let fen = "";
    
    for (let row = 0; row < 8; row++) {
        let emptyCount = 0;
        for (let col = 0; col < 8; col++) {
            const piece = board[row][col];
            if (!piece) {
                emptyCount++;
            } else {
                if (emptyCount > 0) {
                    fen += emptyCount;
                    emptyCount = 0;
                }
                fen += pieceMap[piece];
            }
        }
        if (emptyCount > 0) {
            fen += emptyCount;
        }
        if (row < 7) fen += "/";
    }
    
    fen += " " + (currentPlayer === 'white' ? "w" : "b");
    
    let castling = "";
    if (castlingRights.whiteKingside) castling += "K";
    if (castlingRights.whiteQueenside) castling += "Q";
    if (castlingRights.blackKingside) castling += "k";
    if (castlingRights.blackQueenside) castling += "q";
    fen += " " + (castling || "-");
    
    if (enPassantTarget) {
        const file = String.fromCharCode(97 + enPassantTarget.col);
        const rank = 8 - enPassantTarget.row;
        fen += " " + file + rank;
    } else {
        fen += " -";
    }
    
    fen += " " + halfMoveCount + " " + moveCount;
    
    return fen;
};

window.fen = window.getFEN;
window.board = window.displayBoard;

window.setup = function(positionName) {
    const positions = {
        "start": "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
        "test": "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"
    };
    
    if (positions[positionName]) {
        console.log(`Setting up ${positionName} position...`);
        return window.setFEN(positions[positionName]);
    } else {
        console.log(`Available positions: ${Object.keys(positions).join(", ")}`);
        return false;
    }
};

window.move = function(moveStr) {
    const move = parseAlgebraicMove(moveStr);
    if (move && isValidMove(move.fromRow, move.fromCol, move.toRow, move.toCol)) {
        makeMove(move.fromRow, move.fromCol, move.toRow, move.toCol);
        switchPlayer();
        updateStatus();
        console.log(`✅ Move ${moveStr} made successfully`);
        window.displayBoard();
        return `Move ${moveStr} made successfully`;
    } else {
        console.error(`❌ Invalid move: ${moveStr}`);
        return false;
    }
};

window.legalMoves = function() {
    const moves = getAllPossibleMoves(currentPlayer);
    const algebraicMoves = moves.map(move => toAlgebraicMove(move.fromRow, move.fromCol, move.toRow, move.toCol));
    console.log(`Legal moves for ${currentPlayer} (${moves.length} total):`);
    algebraicMoves.forEach(move => console.log(`  ${move}`));
    return algebraicMoves;
};

window.eval = function() {
    const score = evaluatePositionForSearch(board, currentPlayer, moveCount);
    const isEndgame = isEndgamePositionForPosition(board);
    console.log(`Position evaluation: ${score}`);
    console.log(`Phase: ${isEndgame ? "Endgame" : "Middlegame/Opening"}`);
    
    if (patternLearner && patternLearner.loaded) {
        const stats = patternLearner.getStats();
        console.log(`📊 Pattern DB: ${stats.totalGames} games, ${stats.tacticalPatterns} patterns learned`);
    }
    
    return score;
};

window.ai = function() {
    if (gameMode !== 'ai') {
        console.log("Game mode is not AI. Use 'setMode ai' first.");
        return;
    }
    if (gameOver) {
        console.log("Game is over. Start a new game first.");
        return;
    }
    if (currentPlayer === humanPlayer) {
        console.log("It's your turn! Make a move or switch sides.");
        return;
    }
    console.log("AI is thinking...");
    makeAIMove();
    return "AI move initiated";
};

window.setDepth = function(depth) {
    if (depth >= 1 && depth <= 6) {
        SEARCH_CONFIG.baseDepth = depth;
        SEARCH_CONFIG.endgameDepth = depth + 2;
        console.log(`AI depth set to ${depth} (endgame depth: ${depth+2})`);
        return `AI depth set to ${depth}`;
    } else {
        console.log("Depth must be between 1 and 6");
        return false;
    }
};

window.setMode = function(mode) {
    if (mode === 'ai' || mode === 'player') {
        gameMode = mode;
        const gameModeSelect = document.getElementById('gameMode');
        if (gameModeSelect) gameModeSelect.value = mode;
        changeGameMode();
        console.log(`Game mode set to ${mode === 'ai' ? 'vs AI' : 'vs Player'}`);
        return `Game mode set to ${mode}`;
    } else {
        console.log("Invalid mode. Use 'ai' or 'player'");
        return false;
    }
};

window.switchSide = function() {
    switchSides();
    return `Switched sides. Human now plays ${humanPlayer}`;
};

window.stats = function() {
    console.log("\n=== GAME STATISTICS ===");
    console.log(`Version: ${GAME_VERSION} (Checkmate Knowledge + Anti-Endless Checks)`);
    console.log(`Mode: ${gameMode === 'ai' ? 'vs AI' : 'vs Player'}`);
    console.log(`Current player: ${currentPlayer}`);
    console.log(`Move number: ${moveCount}`);
    console.log(`Game over: ${gameOver}`);
    console.log(`Human plays: ${humanPlayer}`);
    console.log(`AI plays: ${aiPlayer}`);
    
    if (moveTree) {
        const stats = moveTree.getStats();
        console.log(`\n=== AI MEMORY STATS ===`);
        console.log(`Total cached moves: ${stats.totalMoves}`);
        console.log(`Cached positions: ${stats.cachedPositions}`);
    }
    
    if (openingBook) {
        console.log(`\n=== OPENING BOOK ===`);
        console.log(`Status: Loaded`);
    }
    
    if (patternLearner && patternLearner.loaded) {
        const pStats = patternLearner.getStats();
        console.log(`\n=== PATTERN LEARNER ===`);
        console.log(`Games analyzed: ${pStats.totalGames}`);
        console.log(`White wins: ${pStats.whiteWins} (${(pStats.whiteWins/pStats.totalGames*100).toFixed(1)}%)`);
        console.log(`Black wins: ${pStats.blackWins} (${(pStats.blackWins/pStats.totalGames*100).toFixed(1)}%)`);
        console.log(`Draws: ${pStats.draws} (${(pStats.draws/pStats.totalGames*100).toFixed(1)}%)`);
        console.log(`Avg moves/game: ${pStats.avgMoves}`);
        console.log(`Patterns learned: ${pStats.tacticalPatterns}`);
    }
    
    return "Stats displayed above";
};

window.undo = function() {
    if (gameHistory.length === 0) {
        console.log("No moves to undo");
        return;
    }
    undoMove();
    console.log("Move undone");
    window.displayBoard();
    return "Move undone";
};

window.newGame = function() {
    newGame();
    console.log("New game started");
    window.displayBoard();
    return "New game started";
};

window.clearMemory = function() {
    clearMemory();
    return "Memory cleared";
};

window.analyzeMove = function(moveStr) {
    const move = parseAlgebraicMove(moveStr);
    if (!move) {
        console.log("Invalid move format");
        return;
    }
    
    const boardState = board;
    const target = boardState[move.toRow][move.toCol];
    
    console.log(`\n📊 Move Analysis for ${moveStr}:`);
    
    if (target) {
        const safety = evaluateCaptureSafety(boardState, move.fromRow, move.fromCol, move.toRow, move.toCol, currentPlayer);
        console.log(`  Capture safety score: ${safety}`);
    }
    
    const wouldHang = wouldHangPiece(boardState, move.fromRow, move.fromCol, move.toRow, move.toCol, currentPlayer);
    console.log(`  Would hang a piece: ${wouldHang ? '⚠️ YES' : '✅ No'}`);
    
    const checkmateScore = evaluateCheckmatePatterns(boardState, currentPlayer);
    console.log(`  Checkmate potential: ${checkmateScore}`);
    
    if (patternLearner && patternLearner.loaded) {
        const advice = patternLearner.getTacticalAdvice(boardState, currentPlayer);
        if (advice && advice.length) {
            console.log(`\n  📚 Pattern DB Advice:`);
            advice.forEach(a => console.log(`    • ${a}`));
        }
    }
    
    return { wouldHang, checkmateScore };
};

window.help = function() {
    console.log("\n╔═══════════════════════════════════════════════════════════════╗");
    console.log("║              CHESS GAME CONSOLE COMMANDS v2.4.1                ║");
    console.log("║      (Checkmate Knowledge + Anti-Endless Checks + DB)          ║");
    console.log("╚═══════════════════════════════════════════════════════════════╝");
    console.log("\n📌 BOARD & POSITION:");
    console.log("  board()            - Show current board");
    console.log("  setFEN('fen')      - Set position from FEN");
    console.log("  getFEN()           - Get current FEN");
    console.log("\n🎮 MOVES:");
    console.log("  move('e2e4')       - Make a move");
    console.log("  legalMoves()       - Show all legal moves");
    console.log("  undo()             - Undo last move");
    console.log("\n🤖 AI & EVALUATION:");
    console.log("  eval()             - Evaluate position");
    console.log("  ai()               - Force AI move");
    console.log("  setDepth(n)        - Set AI depth (1-6)");
    console.log("  setMode('ai/player') - Switch game mode");
    console.log("  switchSide()       - Switch sides");
    console.log("\n🎯 ANALYSIS:");
    console.log("  analyzeMove('e4d5') - Analyze move quality (incl. checkmate potential)");
    console.log("\n📊 GAME INFO:");
    console.log("  stats()            - Show game statistics");
    console.log("  newGame()          - Start new game");
    console.log("  clearMemory()      - Clear AI memory");
    console.log("  help()             - Show this help");
    console.log("\n🆕 v2.4.1 Features:");
    console.log("  • Checkmate pattern recognition");
    console.log("  • Anti-endless check prevention");
    console.log("  • Pattern database learning");
    console.log("\n");
    return "Help displayed above";
};

// Convert move from algebraic notation to coordinates
function parseAlgebraicMove(moveStr) {
    if (!moveStr || moveStr.length < 4) return null;
    const fromCol = moveStr.charCodeAt(0) - 97;
    const fromRow = 8 - parseInt(moveStr[1]);
    const toCol = moveStr.charCodeAt(2) - 97;
    const toRow = 8 - parseInt(moveStr[3]);
    if (fromRow < 0 || fromRow > 7 || fromCol < 0 || fromCol > 7 ||
        toRow < 0 || toRow > 7 || toCol < 0 || toCol > 7) return null;
    return { fromRow, fromCol, toRow, toCol };
}

function toAlgebraicMove(fromRow, fromCol, toRow, toCol) {
    const files = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
    const ranks = ['8', '7', '6', '5', '4', '3', '2', '1'];
    return files[fromCol] + ranks[fromRow] + files[toCol] + ranks[toRow];
}

// ========== RISK ASSESSMENT CLASS ==========
class RiskAssessment {
    constructor() {
        this.riskThreshold = 300;
        this.minimumScoreGain = 50;
    }

    assessLineRisk(lineEvaluations) {
        const risks = [];
        for (const line of lineEvaluations) {
            const riskScore = this.calculateRiskScore(line);
            risks.push({
                ...line,
                riskScore,
                isSafe: riskScore < this.riskThreshold,
                maxLoss: line.worstCase - line.bestCase
            });
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
            console.log("⚠️ All lines have risk! Choosing least risky option...");
            riskAssessedLines.sort((a, b) => a.riskScore - b.riskScore);
            return riskAssessedLines[0];
        }
        
        safeLines.sort((a, b) => b.bestCase - a.bestCase);
        return safeLines[0];
    }
}

let riskAssessor = new RiskAssessment();

// ========== CORE GAME FUNCTIONS ==========

function displayVersion() {
    const stats = moveTree ? moveTree.getStats() : { totalMoves: 0, cachedPositions: 0 };
    console.log(`♔ Chess Game v${GAME_VERSION} - Checkmate Knowledge + Anti-Endless Checks`);
    console.log(`📦 Memory: ${stats.totalMoves} cached moves`);
    console.log(`📚 Pattern DB: ${patternLearner && patternLearner.loaded ? 'Loaded' : 'Not loaded'}`);

    const versionDisplay = document.getElementById('ai-version');
    if (versionDisplay) {
        versionDisplay.textContent = `v${GAME_VERSION}`;
    }
}

// Initialize on page load
window.addEventListener('load', function() {
    moveTree = new PersistentMoveTree();
    
    if (typeof window !== 'undefined') {
        window.board = board;
        window.castlingRights = castlingRights;
        window.enPassantTarget = enPassantTarget;
    }
    
    if (typeof ChessAILearner !== 'undefined') {
        enhancedAI = new ChessAILearner();
        openingBook = enhancedAI;
        console.log(`📖 Opening Book: Loaded`);
    } else {
        console.log("⚠️ Opening book not found - using PMTS only");
    }
    
    if (typeof GamePatternLearner !== 'undefined') {
        patternLearner = new GamePatternLearner();
        
        fetch('games.csv')
            .then(response => {
                if (!response.ok) throw new Error('CSV not found');
                return response.text();
            })
            .then(csvText => {
                return patternLearner.loadFromCSV(csvText);
            })
            .then(loaded => {
                console.log(`🧠 Pattern Learner: Loaded ${loaded} games for evaluation training`);
                updateAIStats();
            })
            .catch(err => {
                console.log('⚠️ Pattern learner: Could not load games.csv - using standard evaluation');
            });
    } else {
        console.log("⚠️ Pattern learner not found - using standard evaluation");
    }
    
    if (typeof ChessEndgameEngine !== 'undefined') {
        endgameEngine = new ChessEndgameEngine();
        console.log(`♟️ Endgame Engine loaded!`);
    }
    
    createBoard();
    updateStatus();
    updateAIStats();
    changeGameMode();
    displayVersion();
    
    console.log(`♔ Chess Game v${GAME_VERSION} Loaded! ♛`);
    console.log(`💡 Type 'help()' in console to see available commands!`);
});

function createBoard() {
    const boardElement = document.getElementById('chessboard');
    if (!boardElement) return;

    boardElement.innerHTML = '';

    for (let row = 0; row < 8; row++) {
        for (let col = 0; col < 8; col++) {
            const square = document.createElement('div');
            square.className = 'square';
            square.id = `square-${row}-${col}`;

            if ((row + col) % 2 === 0) {
                square.classList.add('light');
            } else {
                square.classList.add('dark');
            }

            if (lastMove && 
                ((lastMove.fromRow === row && lastMove.fromCol === col) ||
                 (lastMove.toRow === row && lastMove.toCol === col))) {
                square.classList.add('last-move');
            }

            const piece = board[row][col];
            if ((piece === '♔' && isKingInCheck(board, 'white')) ||
                (piece === '♚' && isKingInCheck(board, 'black'))) {
                square.classList.add('in-check');
            }

            square.textContent = board[row][col];
            square.onclick = () => handleSquareClick(row, col);

            boardElement.appendChild(square);
        }
    }
}

function handleSquareClick(row, col) {
    if (gameOver || isThinking) return;
    if (gameMode === 'ai' && currentPlayer !== humanPlayer) return;

    const piece = board[row][col];

    if (selectedSquare) {
        const fromRow = selectedSquare.row;
        const fromCol = selectedSquare.col;

        if (fromRow === row && fromCol === col) {
            clearSelection();
            return;
        }

        if (isValidMove(fromRow, fromCol, row, col)) {
            makeMove(fromRow, fromCol, row, col);
            clearSelection();
            switchPlayer();
            updateStatus();

            if (gameMode === 'ai' && !gameOver && currentPlayer !== humanPlayer) {
                setTimeout(makeAIMove, 300);
            }
        } else {
            if (piece && isPlayerPiece(piece, currentPlayer)) {
                selectSquare(row, col);
            } else {
                clearSelection();
            }
        }
    } else {
        if (piece && isPlayerPiece(piece, currentPlayer)) {
            selectSquare(row, col);
        }
    }
}

function selectSquare(row, col) {
    clearSelection();
    selectedSquare = { row, col };
    const squareElement = document.getElementById(`square-${row}-${col}`);
    if (squareElement) {
        squareElement.classList.add('selected');
    }
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
    for (let r = 0; r < 8; r++) {
        for (let c = 0; c < 8; c++) {
            if (isValidMove(row, col, r, c)) {
                const square = document.getElementById(`square-${r}-${c}`);
                if (square) {
                    if (board[r][c] && isPlayerPiece(board[r][c], currentPlayer === 'white' ? 'black' : 'white')) {
                        square.classList.add('capture-move');
                    } else {
                        square.classList.add('possible-move');
                    }
                }
            }
        }
    }
}

function isPlayerPiece(piece, player) {
    if (!piece) return false;
    const whitePieces = ['♔', '♕', '♖', '♗', '♘', '♙'];
    const blackPieces = ['♚', '♛', '♜', '♝', '♞', '♟'];
    return player === 'white' ? whitePieces.includes(piece) : blackPieces.includes(piece);
}

function isValidMove(fromRow, fromCol, toRow, toCol) {
    if (toRow < 0 || toRow > 7 || toCol < 0 || toCol > 7) return false;

    const piece = board[fromRow][fromCol];
    const targetPiece = board[toRow][toCol];

    if (!piece) return false;
    if (targetPiece && isPlayerPiece(targetPiece, currentPlayer)) return false;

    if ((piece === '♔' || piece === '♚') && Math.abs(toCol - fromCol) === 2 && fromRow === toRow) {
        return canCastle(fromRow, fromCol, toRow, toCol);
    }

    const pieceCode = pieceMap[piece];
    if (!isValidPieceMove(pieceCode, fromRow, fromCol, toRow, toCol)) return false;

    return !wouldLeaveKingInCheck(fromRow, fromCol, toRow, toCol);
}

function isValidPieceMove(piece, fromRow, fromCol, toRow, toCol) {
    const dx = toCol - fromCol;
    const dy = toRow - fromRow;
    const absDx = Math.abs(dx);
    const absDy = Math.abs(dy);

    switch (piece.toLowerCase()) {
        case 'p':
            return isValidPawnMove(piece, fromRow, fromCol, toRow, toCol, dx, dy);
        case 'r':
            return (dx === 0 || dy === 0) && isPathClear(fromRow, fromCol, toRow, toCol);
        case 'n':
            return (absDx === 2 && absDy === 1) || (absDx === 1 && absDy === 2);
        case 'b':
            return absDx === absDy && isPathClear(fromRow, fromCol, toRow, toCol);
        case 'q':
            return (dx === 0 || dy === 0 || absDx === absDy) && isPathClear(fromRow, fromCol, toRow, toCol);
        case 'k':
            return absDx <= 1 && absDy <= 1;
        default:
            return false;
    }
}

function isValidPawnMove(piece, fromRow, fromCol, toRow, toCol, dx, dy) {
    const direction = piece === 'P' ? -1 : 1;
    const startRow = piece === 'P' ? 6 : 1;
    const absDx = Math.abs(dx);

    if (dx === 0) {
        if (dy === direction && !board[toRow][toCol]) return true;
        if (fromRow === startRow && dy === 2 * direction && !board[toRow][toCol]) {
            const intermediateRow = fromRow + direction;
            if (!board[intermediateRow][fromCol]) return true;
        }
    } else if (absDx === 1 && dy === direction) {
        if (board[toRow][toCol]) return true;
        if (enPassantTarget && toRow === enPassantTarget.row && toCol === enPassantTarget.col) {
            return true;
        }
    }

    return false;
}

function isPathClear(fromRow, fromCol, toRow, toCol) {
    const dx = Math.sign(toCol - fromCol);
    const dy = Math.sign(toRow - fromRow);
    let currentRow = fromRow + dy;
    let currentCol = fromCol + dx;

    while (currentRow !== toRow || currentCol !== toCol) {
        if (board[currentRow][currentCol]) return false;
        currentRow += dy;
        currentCol += dx;
    }
    return true;
}

function wouldLeaveKingInCheck(fromRow, fromCol, toRow, toCol) {
    const piece = board[fromRow][fromCol];
    const originalTarget = board[toRow][toCol];

    board[toRow][toCol] = piece;
    board[fromRow][fromCol] = '';

    const inCheck = isKingInCheck(board, currentPlayer);

    board[fromRow][fromCol] = piece;
    board[toRow][toCol] = originalTarget;

    return inCheck;
}

function canCastle(fromRow, fromCol, toRow, toCol) {
    const piece = board[fromRow][fromCol];
    const isWhite = piece === '♔';
    const isKingside = toCol > fromCol;

    if ((isWhite && fromRow !== 7) || (!isWhite && fromRow !== 0)) return false;

    if (isWhite) {
        if (isKingside && !castlingRights.whiteKingside) return false;
        if (!isKingside && !castlingRights.whiteQueenside) return false;
    } else {
        if (isKingside && !castlingRights.blackKingside) return false;
        if (!isKingside && !castlingRights.blackQueenside) return false;
    }

    if (isKingInCheck(board, currentPlayer)) return false;

    const rookCol = isKingside ? 7 : 0;
    const expectedRook = isWhite ? '♖' : '♜';
    if (board[fromRow][rookCol] !== expectedRook) return false;

    const start = Math.min(fromCol, rookCol) + 1;
    const end = Math.max(fromCol, rookCol);

    for (let col = start; col < end; col++) {
        if (board[fromRow][col] !== '') return false;
    }

    const direction = isKingside ? 1 : -1;
    for (let i = 0; i <= 2; i++) {
        const testCol = fromCol + (direction * i);
        if (testCol >= 0 && testCol <= 7) {
            const originalPiece = board[fromRow][testCol];
            board[fromRow][testCol] = piece;
            if (testCol !== fromCol) board[fromRow][fromCol] = '';

            const inCheck = isKingInCheck(board, currentPlayer);

            board[fromRow][fromCol] = piece;
            board[fromRow][testCol] = originalPiece;

            if (inCheck) return false;
        }
    }

    return true;
}

function isKingInCheck(testBoard, player) {
    if (!testBoard) return false;
    
    const kingSymbol = player === 'white' ? '♔' : '♚';
    let kingRow = -1, kingCol = -1;

    for (let row = 0; row < 8; row++) {
        for (let col = 0; col < 8; col++) {
            if (testBoard[row] && testBoard[row][col] === kingSymbol) {
                kingRow = row;
                kingCol = col;
                break;
            }
        }
        if (kingRow !== -1) break;
    }

    if (kingRow === -1) return false;

    return isSquareAttacked(testBoard, kingRow, kingCol, player === 'white' ? 'black' : 'white');
}

function isSquareAttacked(testBoard, targetRow, targetCol, attackerColor) {
    if (!testBoard) return false;
    
    for (let row = 0; row < 8; row++) {
        for (let col = 0; col < 8; col++) {
            const piece = testBoard[row] && testBoard[row][col];
            if (piece && isPlayerPiece(piece, attackerColor)) {
                if (canPieceAttack(piece, row, col, targetRow, targetCol, testBoard)) {
                    return true;
                }
            }
        }
    }
    return false;
}

function canPieceAttack(piece, fromRow, fromCol, toRow, toCol, testBoard) {
    const pieceCode = pieceMap[piece];
    const dx = toCol - fromCol;
    const dy = toRow - fromRow;
    const absDx = Math.abs(dx);
    const absDy = Math.abs(dy);

    switch (pieceCode.toLowerCase()) {
        case 'p':
            const direction = pieceCode === 'P' ? -1 : 1;
            return absDx === 1 && dy === direction;
        case 'r':
            return (dx === 0 || dy === 0) && isPathClearOnBoard(testBoard, fromRow, fromCol, toRow, toCol);
        case 'n':
            return (absDx === 2 && absDy === 1) || (absDx === 1 && absDy === 2);
        case 'b':
            return absDx === absDy && isPathClearOnBoard(testBoard, fromRow, fromCol, toRow, toCol);
        case 'q':
            return (dx === 0 || dy === 0 || absDx === absDy) && isPathClearOnBoard(testBoard, fromRow, fromCol, toRow, toCol);
        case 'k':
            return absDx <= 1 && absDy <= 1;
        default:
            return false;
    }
}

function isPathClearOnBoard(testBoard, fromRow, fromCol, toRow, toCol) {
    const dx = Math.sign(toCol - fromCol);
    const dy = Math.sign(toRow - fromRow);
    let currentRow = fromRow + dy;
    let currentCol = fromCol + dx;

    while (currentRow !== toRow || currentCol !== toCol) {
        if (testBoard[currentRow] && testBoard[currentRow][currentCol]) return false;
        currentRow += dy;
        currentCol += dx;
    }
    return true;
}

function makeMove(fromRow, fromCol, toRow, toCol) {
    const piece = board[fromRow][fromCol];
    const capturedPiece = board[toRow][toCol];
    
    gameHistory.push({
        board: board.map(row => [...row]),
        currentPlayer: currentPlayer,
        moveHistory: [...moveHistory],
        moveCount: moveCount,
        halfMoveCount: halfMoveCount,
        castlingRights: { ...castlingRights },
        lastMove: lastMove,
        enPassantTarget: enPassantTarget
    });
    
    lastMove = { fromRow, fromCol, toRow, toCol };
    
    const algebraicMove = toAlgebraicMove(fromRow, fromCol, toRow, toCol);
    if (moveTree) {
        moveTree.activeLineMoves.push(algebraicMove);
    }
    
    if ((piece === '♙' || piece === '♟') && enPassantTarget && 
        toRow === enPassantTarget.row && toCol === enPassantTarget.col) {
        const capturedPawnRow = piece === '♙' ? toRow + 1 : toRow - 1;
        board[capturedPawnRow][toCol] = '';
    }
    
    if ((piece === '♔' || piece === '♚') && Math.abs(toCol - fromCol) === 2) {
        const isKingside = toCol > fromCol;
        const rookFromCol = isKingside ? 7 : 0;
        const rookToCol = isKingside ? 5 : 3;
        const rook = board[fromRow][rookFromCol];
        
        board[fromRow][rookToCol] = rook;
        board[fromRow][rookFromCol] = '';
    }
    
    board[toRow][toCol] = piece;
    board[fromRow][fromCol] = '';
    
    if ((piece === '♙' && toRow === 0) || (piece === '♟' && toRow === 7)) {
        board[toRow][toCol] = piece === '♙' ? '♕' : '♛';
    }
    
    enPassantTarget = null;
    if ((piece === '♙' || piece === '♟') && Math.abs(toRow - fromRow) === 2) {
        enPassantTarget = {
            row: fromRow + (toRow - fromRow) / 2,
            col: fromCol
        };
    }
    
    updateCastlingRights(piece, fromRow, fromCol, toRow, toCol);
    updateHalfMoveClock(piece, capturedPiece);
    
    if (currentPlayer === 'black') {
        moveCount++;
    }
    
    moveHistory.push(algebraicMove);
    updateMoveHistory();
    
    createBoard();
    
    if (moveTree) {
        moveTree.pruneInactiveLines(moveTree.activeLineMoves);
    }
}

function updateCastlingRights(piece, fromRow, fromCol, toRow, toCol) {
    if (piece === '♔') {
        castlingRights.whiteKingside = false;
        castlingRights.whiteQueenside = false;
    } else if (piece === '♚') {
        castlingRights.blackKingside = false;
        castlingRights.blackQueenside = false;
    }

    if (piece === '♖' && fromRow === 7) {
        if (fromCol === 0) castlingRights.whiteQueenside = false;
        if (fromCol === 7) castlingRights.whiteKingside = false;
    } else if (piece === '♜' && fromRow === 0) {
        if (fromCol === 0) castlingRights.blackQueenside = false;
        if (fromCol === 7) castlingRights.blackKingside = false;
    }
}

function updateHalfMoveClock(piece, capturedPiece) {
    if (piece === '♙' || piece === '♟' || capturedPiece) {
        halfMoveCount = 0;
    } else {
        halfMoveCount++;
    }
}

function switchPlayer() {
    currentPlayer = currentPlayer === 'white' ? 'black' : 'white';
}

function updateStatus() {
    const statusElement = document.getElementById('status');
    const currentPlayerElement = document.getElementById('current-player');
    const moveCounterElement = document.getElementById('move-counter');

    if (!statusElement || !currentPlayerElement || !moveCounterElement) return;

    if (isCheckmate()) {
        const winner = currentPlayer === 'white' ? 'Black' : 'White';
        statusElement.textContent = `Checkmate! ${winner} wins!`;
        statusElement.classList.add('checkmate');
        gameOver = true;
    } else if (isStalemate()) {
        statusElement.textContent = 'Stalemate! Draw!';
        gameOver = true;
    } else if (isDraw()) {
        statusElement.textContent = 'Draw!';
        gameOver = true;
    } else if (isKingInCheck(board, currentPlayer)) {
        statusElement.textContent = `${currentPlayer.charAt(0).toUpperCase() + currentPlayer.slice(1)} is in check!`;
        statusElement.classList.add('check');
    } else {
        statusElement.textContent = `${currentPlayer.charAt(0).toUpperCase() + currentPlayer.slice(1)} to move`;
        statusElement.classList.remove('checkmate', 'check');
    }

    currentPlayerElement.textContent = currentPlayer.charAt(0).toUpperCase() + currentPlayer.slice(1);
    moveCounterElement.textContent = moveCount;
}

function isCheckmate() {
    if (!isKingInCheck(board, currentPlayer)) return false;
    return getAllPossibleMoves(currentPlayer).length === 0;
}

function isStalemate() {
    if (isKingInCheck(board, currentPlayer)) return false;
    return getAllPossibleMoves(currentPlayer).length === 0;
}

function isDraw() {
    return halfMoveCount >= 100 || isInsufficientMaterial();
}

function isInsufficientMaterial() {
    const pieces = [];
    for (let row = 0; row < 8; row++) {
        for (let col = 0; col < 8; col++) {
            const piece = board[row][col];
            if (piece && piece !== '♔' && piece !== '♚') {
                pieces.push(piece);
            }
        }
    }

    if (pieces.length === 0) return true;
    if (pieces.length === 1 && (pieces[0] === '♗' || pieces[0] === '♝' || pieces[0] === '♘' || pieces[0] === '♞')) return true;

    return false;
}

function getAllPossibleMoves(player) {
    const moves = [];
    for (let fromRow = 0; fromRow < 8; fromRow++) {
        for (let fromCol = 0; fromCol < 8; fromCol++) {
            const piece = board[fromRow][fromCol];
            if (piece && isPlayerPiece(piece, player)) {
                for (let toRow = 0; toRow < 8; toRow++) {
                    for (let toCol = 0; toCol < 8; toCol++) {
                        if (isValidMove(fromRow, fromCol, toRow, toCol)) {
                            moves.push({ fromRow, fromCol, toRow, toCol });
                        }
                    }
                }
            }
        }
    }
    return moves;
}

function updateMoveHistory() {
    const moveListElement = document.getElementById('move-list');
    if (!moveListElement) return;

    const formattedMoves = [];

    for (let i = 0; i < moveHistory.length; i += 2) {
        const moveNumber = Math.floor(i / 2) + 1;
        const whiteMove = moveHistory[i] || '';
        const blackMove = moveHistory[i + 1] || '';
        formattedMoves.push(`${moveNumber}. ${whiteMove} ${blackMove}`);
    }

    moveListElement.textContent = formattedMoves.join(' ');
}

// ========== POSITION EVALUATION FUNCTIONS ==========

function isPlayerPieceForPosition(piece, player) {
    if (!piece) return false;
    const whitePieces = ['♔', '♕', '♖', '♗', '♘', '♙'];
    const blackPieces = ['♚', '♛', '♜', '♝', '♞', '♟'];
    return player === 'white' ? whitePieces.includes(piece) : blackPieces.includes(piece);
}

function isPathClearForPosition(boardState, fromRow, fromCol, toRow, toCol) {
    if (!boardState) return false;
    
    const dx = Math.sign(toCol - fromCol);
    const dy = Math.sign(toRow - fromRow);
    let currentRow = fromRow + dy;
    let currentCol = fromCol + dx;

    while (currentRow !== toRow || currentCol !== toCol) {
        if (boardState[currentRow] && boardState[currentRow][currentCol]) return false;
        currentRow += dy;
        currentCol += dx;
    }
    return true;
}

function canPieceAttackForPosition(piece, fromRow, fromCol, toRow, toCol, boardState) {
    const pieceCode = pieceMap[piece];
    if (!pieceCode) return false;

    const dx = toCol - fromCol;
    const dy = toRow - fromRow;
    const absDx = Math.abs(dx);
    const absDy = Math.abs(dy);

    switch (pieceCode.toLowerCase()) {
        case 'p':
            const direction = pieceCode === 'P' ? -1 : 1;
            return absDx === 1 && dy === direction;
        case 'r':
            return (dx === 0 || dy === 0) && isPathClearForPosition(boardState, fromRow, fromCol, toRow, toCol);
        case 'n':
            return (absDx === 2 && absDy === 1) || (absDx === 1 && absDy === 2);
        case 'b':
            return absDx === absDy && isPathClearForPosition(boardState, fromRow, fromCol, toRow, toCol);
        case 'q':
            return (dx === 0 || dy === 0 || absDx === absDy) && isPathClearForPosition(boardState, fromRow, fromCol, toRow, toCol);
        case 'k':
            return absDx <= 1 && absDy <= 1;
        default:
            return false;
    }
}

function isSquareAttackedForPosition(boardState, targetRow, targetCol, attackerColor) {
    if (!boardState) return false;
    
    for (let row = 0; row < 8; row++) {
        for (let col = 0; col < 8; col++) {
            const attacker = boardState[row] && boardState[row][col];
            if (attacker && isPlayerPieceForPosition(attacker, attackerColor)) {
                if (canPieceAttackForPosition(attacker, row, col, targetRow, targetCol, boardState)) {
                    return true;
                }
            }
        }
    }
    return false;
}

function isKingInCheckForPosition(boardState, player) {
    if (!boardState) return false;
    
    const kingSymbol = player === 'white' ? '♔' : '♚';
    let kingRow = -1, kingCol = -1;

    for (let row = 0; row < 8; row++) {
        for (let col = 0; col < 8; col++) {
            if (boardState[row] && boardState[row][col] === kingSymbol) {
                kingRow = row;
                kingCol = col;
                break;
            }
        }
        if (kingRow !== -1) break;
    }

    if (kingRow === -1) return false;

    const attackerColor = player === 'white' ? 'black' : 'white';
    return isSquareAttackedForPosition(boardState, kingRow, kingCol, attackerColor);
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

    const dx = toCol - fromCol;
    const dy = toRow - fromRow;
    const absDx = Math.abs(dx);
    const absDy = Math.abs(dy);

    let valid = false;
    switch (pieceCode.toLowerCase()) {
        case 'p':
            const direction = pieceCode === 'P' ? -1 : 1;
            const startRow = pieceCode === 'P' ? 6 : 1;
            if (dx === 0) {
                if (dy === direction && !boardState[toRow][toCol]) valid = true;
                if (fromRow === startRow && dy === 2 * direction && !boardState[toRow][toCol]) {
                    const intermediateRow = fromRow + direction;
                    if (!boardState[intermediateRow][fromCol]) valid = true;
                }
            } else if (absDx === 1 && dy === direction && boardState[toRow][toCol]) {
                valid = true;
            }
            break;
        case 'r':
            valid = (dx === 0 || dy === 0) && isPathClearForPosition(boardState, fromRow, fromCol, toRow, toCol);
            break;
        case 'n':
            valid = (absDx === 2 && absDy === 1) || (absDx === 1 && absDy === 2);
            break;
        case 'b':
            valid = absDx === absDy && isPathClearForPosition(boardState, fromRow, fromCol, toRow, toCol);
            break;
        case 'q':
            valid = (dx === 0 || dy === 0 || absDx === absDy) && isPathClearForPosition(boardState, fromRow, fromCol, toRow, toCol);
            break;
        case 'k':
            valid = absDx <= 1 && absDy <= 1;
            break;
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
    for (let fromRow = 0; fromRow < 8; fromRow++) {
        for (let fromCol = 0; fromCol < 8; fromCol++) {
            const piece = boardState[fromRow] && boardState[fromRow][fromCol];
            if (piece && isPlayerPieceForPosition(piece, player)) {
                for (let toRow = 0; toRow < 8; toRow++) {
                    for (let toCol = 0; toCol < 8; toCol++) {
                        if (isValidMoveForPosition(boardState, fromRow, fromCol, toRow, toCol, player)) {
                            moves.push({ fromRow, fromCol, toRow, toCol });
                        }
                    }
                }
            }
        }
    }
    return moves;
}

function isEndgamePositionForPosition(boardState) {
    if (!boardState) return false;
    
    let pieceCount = 0;
    for (let row = 0; row < 8; row++) {
        for (let col = 0; col < 8; col++) {
            const piece = boardState[row] && boardState[row][col];
            if (piece && piece !== '♔' && piece !== '♚') {
                pieceCount++;
            }
        }
    }
    return pieceCount <= 10;
}

function evaluatePositionForSearch(boardState, player, moveNumber) {
    if (!boardState) return 0;
    
    let evaluation = 0;
    const isEndgame = isEndgamePositionForPosition(boardState);

    // Use pattern learner if available
    if (patternLearner && patternLearner.loaded) {
        evaluation = patternLearner.evaluatePosition(boardState, player);
    } else {
        // Material evaluation
        for (let row = 0; row < 8; row++) {
            for (let col = 0; col < 8; col++) {
                const piece = boardState[row] && boardState[row][col];
                if (piece) {
                    const value = PIECE_VALUES[piece] || 0;
                    evaluation += isPlayerPieceForPosition(piece, 'white') ? value : -value;
                }
            }
        }

        // Positional evaluation
        for (let row = 0; row < 8; row++) {
            for (let col = 0; col < 8; col++) {
                const piece = boardState[row] && boardState[row][col];
                if (piece) {
                    let tableValue = 0;
                    const pieceColor = isPlayerPieceForPosition(piece, 'white') ? 'white' : 'black';
                    
                    if (isEndgame && (piece === '♔' || piece === '♚') && ENDGAME_PIECE_SQUARE_TABLES[piece]) {
                        tableValue = ENDGAME_PIECE_SQUARE_TABLES[piece][row][col];
                    } else if (pieceColor === 'black' && BLACK_PIECE_SQUARE_TABLES[piece]) {
                        tableValue = BLACK_PIECE_SQUARE_TABLES[piece][row][col];
                    } else if (PIECE_SQUARE_TABLES[piece]) {
                        tableValue = PIECE_SQUARE_TABLES[piece][row][col];
                    }
                    
                    evaluation += pieceColor === 'white' ? tableValue : -tableValue;
                }
            }
        }

        // Center control
        const centerBonus = 25;
        const centers = [[3,3], [3,4], [4,3], [4,4]];
        for (const [r,c] of centers) {
            const piece = boardState[r] && boardState[r][c];
            if (piece) {
                evaluation += isPlayerPieceForPosition(piece, 'white') ? centerBonus : -centerBonus;
            }
        }

        // Mobility
        const whiteMoves = getAllPossibleMovesForPosition(boardState, 'white').length;
        const blackMoves = getAllPossibleMovesForPosition(boardState, 'black').length;
        evaluation += (whiteMoves - blackMoves) * 5;
    }
    
    // Apply endgame check penalty
    evaluation += getEndgameCheckPenalty(boardState, player, moveHistory);
    
    // Add checkmate pattern bonus (only for the player to move)
    const mateBonus = evaluateCheckmatePatterns(boardState, player);
    evaluation += mateBonus;
    
    return evaluation;
}

// ========== MINIMAX WITH RISK ASSESSMENT ==========

const SEARCH_CONFIG = {
    baseDepth: 3,
    endgameDepth: 5,
    useMemory: true,
    riskAssessment: true
};

let transpositionTable = new Map();

function minimaxWithRisk(boardState, depth, alpha, beta, isMaximizingPlayer, player, moveNumber, trackWorstCase = false) {
    if (!boardState) return 0;
    if (depth === 0) {
        return evaluatePositionForSearch(boardState, player, moveNumber);
    }

    const moves = getAllPossibleMovesForPosition(boardState, player);
    if (moves.length === 0) {
        const inCheck = isKingInCheckForPosition(boardState, player);
        if (inCheck) {
            return isMaximizingPlayer ? -20000 : 20000;
        }
        return 0;
    }

    moves.sort((a, b) => {
        const targetA = boardState[a.toRow][a.toCol];
        const targetB = boardState[b.toRow][b.toCol];
        if (targetA && !targetB) return -1;
        if (!targetA && targetB) return 1;
        const valueA = targetA ? PIECE_VALUES[targetA] : 0;
        const valueB = targetB ? PIECE_VALUES[targetB] : 0;
        return valueB - valueA;
    });

    if (isMaximizingPlayer) {
        let maxEval = -Infinity;
        let worstCaseEval = Infinity;
        const nextPlayer = player === 'white' ? 'black' : 'white';

        for (const move of moves) {
            const targetPiece = boardState[move.toRow][move.toCol];
            if (targetPiece) {
                const captureSafety = evaluateCaptureSafety(boardState, move.fromRow, move.fromCol, move.toRow, move.toCol, player);
                if (captureSafety < -100) continue;
            }
            
            const newBoard = makeTestMoveForPosition(boardState, move.fromRow, move.fromCol, move.toRow, move.toCol);
            const evaluation = minimaxWithRisk(newBoard, depth - 1, alpha, beta, false, nextPlayer, moveNumber + 1, trackWorstCase);
            
            let evalValue = typeof evaluation === 'object' ? evaluation.best : evaluation;
            
            if (targetPiece) {
                const captureSafety = evaluateCaptureSafety(boardState, move.fromRow, move.fromCol, move.toRow, move.toCol, player);
                evalValue += captureSafety;
            }
            
            if (wouldHangPiece(boardState, move.fromRow, move.fromCol, move.toRow, move.toCol, player)) {
                evalValue -= 80;
            }
            
            maxEval = Math.max(maxEval, evalValue);
            if (trackWorstCase) {
                const worstVal = typeof evaluation === 'object' ? evaluation.worst : evaluation;
                worstCaseEval = Math.min(worstCaseEval, worstVal);
            }
            alpha = Math.max(alpha, evalValue);
            
            if (beta <= alpha) break;
        }
        
        return trackWorstCase ? { best: maxEval, worst: worstCaseEval } : maxEval;
    } else {
        let minEval = Infinity;
        let worstCaseEval = -Infinity;
        const nextPlayer = player === 'white' ? 'black' : 'white';

        for (const move of moves) {
            const targetPiece = boardState[move.toRow][move.toCol];
            if (targetPiece) {
                const captureSafety = evaluateCaptureSafety(boardState, move.fromRow, move.fromCol, move.toRow, move.toCol, player);
                if (captureSafety < -100) continue;
            }
            
            const newBoard = makeTestMoveForPosition(boardState, move.fromRow, move.fromCol, move.toRow, move.toCol);
            const evaluation = minimaxWithRisk(newBoard, depth - 1, alpha, beta, true, nextPlayer, moveNumber + 1, trackWorstCase);
            
            let evalValue = typeof evaluation === 'object' ? evaluation.best : evaluation;
            
            if (targetPiece) {
                const captureSafety = evaluateCaptureSafety(boardState, move.fromRow, move.fromCol, move.toRow, move.toCol, player);
                evalValue -= captureSafety;
            }
            
            if (wouldHangPiece(boardState, move.fromRow, move.fromCol, move.toRow, move.toCol, player)) {
                evalValue += 80;
            }
            
            minEval = Math.min(minEval, evalValue);
            if (trackWorstCase) {
                const worstVal = typeof evaluation === 'object' ? evaluation.worst : evaluation;
                worstCaseEval = Math.max(worstCaseEval, worstVal);
            }
            beta = Math.min(beta, evalValue);
            
            if (beta <= alpha) break;
        }
        
        return trackWorstCase ? { best: minEval, worst: worstCaseEval } : minEval;
    }
}

function findBestMoveWithRiskAssessment() {
    const allMoves = getAllPossibleMoves(currentPlayer);
    if (allMoves.length === 0) return null;
    
    // Try opening book first
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
    
    const evaluatedMoves = [];
    
    for (const move of allMoves) {
        // Skip endless check moves in endgame
        if (isEndgame) {
            const testHistory = [...moveHistory, toAlgebraicMove(move.fromRow, move.fromCol, move.toRow, move.toCol)];
            if (isEndlessCheck(testHistory, currentPlayer)) {
                console.log(`  ⏭️ Skipping endless check move`);
                continue;
            }
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
            
            const bestResult = minimaxWithRisk(newBoard, searchDepth - 1, -Infinity, Infinity, false, 
                currentPlayer === 'white' ? 'black' : 'white', moveCount + 1, false);
            
            const worstResult = minimaxWithRisk(newBoard, searchDepth - 1, -Infinity, Infinity, false, 
                currentPlayer === 'white' ? 'black' : 'white', moveCount + 1, true);
            
            const worstCase = typeof worstResult === 'object' ? worstResult.best : worstResult;
            let bestCase = typeof bestResult === 'object' ? bestResult.best : bestResult;
            
            const targetPiece = board[move.toRow][move.toCol];
            if (targetPiece) {
                const captureSafety = evaluateCaptureSafety(board, move.fromRow, move.fromCol, move.toRow, move.toCol, currentPlayer);
                bestCase += captureSafety;
            }
            
            if (wouldHangPiece(board, move.fromRow, move.fromCol, move.toRow, move.toCol, currentPlayer)) {
                bestCase -= 80;
            }
            
            evaluatedMoves.push({
                move,
                bestCase: bestCase,
                worstCase: worstCase,
                depth: searchDepth
            });
            
            if (moveTree && SEARCH_CONFIG.useMemory) {
                moveTree.storeMoveEvaluation(move, bestCase, searchDepth, [{ worst: worstCase }]);
            }
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
            current.bestCase < best.bestCase ? current : best
        , riskAssessed[0]);
    } else {
        bestSafeMove = riskAssessor.findBestSafeMove(riskAssessed);
    }
    
    const searchTime = (performance.now() - searchStartTime).toFixed(0);
    const moveStr = toAlgebraicMove(bestSafeMove.move.fromRow, bestSafeMove.move.fromCol, bestSafeMove.move.toRow, bestSafeMove.move.toCol);
    console.log(`⏱️ Search time: ${searchTime}ms | Selected: ${moveStr} | Eval: ${bestSafeMove.bestCase}`);
    
    return bestSafeMove.move;
}

function findBestMove() {
    return findBestMoveWithRiskAssessment();
}

function makeAIMove() {
    if (isThinking || gameOver) return;
    if (currentPlayer !== aiPlayer) return;

    isThinking = true;
    const thinkingElement = document.getElementById('thinking');
    const syncStatusElement = document.getElementById('sync-status');

    if (thinkingElement) thinkingElement.style.display = 'block';
    if (syncStatusElement) {
        syncStatusElement.textContent = `AI (${aiPlayer}) thinking...`;
        syncStatusElement.classList.add('thinking');
    }

    setTimeout(() => {
        const bestMove = findBestMove();
        if (bestMove) {
            makeMove(bestMove.fromRow, bestMove.fromCol, bestMove.toRow, bestMove.toCol);
            switchPlayer();
            updateStatus();
        }

        isThinking = false;
        if (thinkingElement) thinkingElement.style.display = 'none';
        if (syncStatusElement) {
            syncStatusElement.textContent = 'Ready';
            syncStatusElement.classList.remove('thinking');
        }
        
        if (moveTree) {
            const stats = moveTree.getStats();
            console.log(`📊 Memory stats: ${stats.totalMoves} moves cached`);
        }
    }, 300);
}

function updateAIStats() {
    const gamesPlayedElement = document.getElementById('games-played');
    const winRateElement = document.getElementById('win-rate');
    const difficultyElement = document.getElementById('ai-difficulty');
    const versionElement = document.getElementById('ai-version');

    if (!gamesPlayedElement || !winRateElement) return;

    gamesPlayedElement.textContent = moveTree ? moveTree.getStats().totalMoves.toString() : '0';
    
    let winRate = '65';
    if (patternLearner && patternLearner.loaded) {
        const stats = patternLearner.getStats();
        winRate = Math.round((stats.whiteWins / stats.totalGames) * 100);
    }
    winRateElement.textContent = winRate;
    
    if (difficultyElement) {
        difficultyElement.textContent = `PMTS v2.4.1 (Checkmate Knowledge)`;
    }
    if (versionElement) {
        versionElement.textContent = `v${GAME_VERSION}`;
    }
}

function newGame() {
    board = [
        ['♜', '♞', '♝', '♛', '♚', '♝', '♞', '♜'],
        ['♟', '♟', '♟', '♟', '♟', '♟', '♟', '♟'],
        ['', '', '', '', '', '', '', ''],
        ['', '', '', '', '', '', '', ''],
        ['', '', '', '', '', '', '', ''],
        ['', '', '', '', '', '', '', ''],
        ['♙', '♙', '♙', '♙', '♙', '♙', '♙', '♙'],
        ['♖', '♘', '♗', '♕', '♔', '♗', '♘', '♖']
    ];

    currentPlayer = 'white';
    selectedSquare = null;
    gameHistory = [];
    moveHistory = [];
    gameOver = false;
    moveCount = 1;
    halfMoveCount = 0;
    lastMove = null;
    isThinking = false;

    castlingRights = {
        whiteKingside: true,
        whiteQueenside: true,
        blackKingside: true,
        blackQueenside: true
    };

    enPassantTarget = null;
    
    if (moveTree) {
        moveTree.activeLineMoves = [];
    }

    createBoard();
    updateStatus();

    const moveListElement = document.getElementById('move-list');
    if (moveListElement) moveListElement.textContent = 'Game started';

    const thinkingElement = document.getElementById('thinking');
    const syncStatusElement = document.getElementById('sync-status');

    if (thinkingElement) thinkingElement.style.display = 'none';
    if (syncStatusElement) {
        syncStatusElement.textContent = 'Ready';
        syncStatusElement.classList.remove('thinking');
    }

    console.log(`🎯 New game started! ${GAME_VERSION} with Checkmate Knowledge!`);
    
    if (gameMode === 'ai' && humanPlayer === 'black' && currentPlayer === 'white') {
        setTimeout(makeAIMove, 500);
    }
}

function undoMove() {
    if (gameHistory.length === 0) return;

    const previousState = gameHistory.pop();
    board = previousState.board;
    currentPlayer = previousState.currentPlayer;
    moveHistory = previousState.moveHistory;
    moveCount = previousState.moveCount;
    halfMoveCount = previousState.halfMoveCount;
    castlingRights = previousState.castlingRights;
    lastMove = previousState.lastMove;
    enPassantTarget = previousState.enPassantTarget;
    gameOver = false;
    
    if (moveTree) {
        moveTree.activeLineMoves.pop();
    }

    createBoard();
    updateStatus();
    updateMoveHistory();

    const statusElement = document.getElementById('status');
    if (statusElement) {
        statusElement.classList.remove('checkmate', 'check');
    }
}

function switchSides() {
    humanPlayer = humanPlayer === 'white' ? 'black' : 'white';
    aiPlayer = humanPlayer === 'white' ? 'black' : 'white';
    
    console.log(`🔄 Switched sides. Human now plays ${humanPlayer}, AI plays ${aiPlayer}`);

    if (gameMode === 'ai' && currentPlayer === aiPlayer && !gameOver) {
        setTimeout(makeAIMove, 500);
    }
}

function changeGameMode() {
    const gameModeSelect = document.getElementById('gameMode');
    const gameModeDisplay = document.getElementById('game-mode-display');
    const aiInfo = document.getElementById('ai-info');

    if (!gameModeSelect || !gameModeDisplay) return;

    gameMode = gameModeSelect.value;

    if (gameMode === 'ai') {
        gameModeDisplay.textContent = 'vs AI (v2.4.1)';
        if (aiInfo) aiInfo.style.display = 'block';

        if (currentPlayer === aiPlayer && !gameOver) {
            setTimeout(makeAIMove, 500);
        }
    } else {
        gameModeDisplay.textContent = 'vs Player';
        if (aiInfo) aiInfo.style.display = 'none';
    }
}

function clearMemory() {
    if (confirm('Clear AI memory? This will delete all cached calculations.')) {
        if (moveTree) {
            moveTree.clear();
        }
        transpositionTable.clear();
        console.log("🧹 Memory cleared!");
        updateAIStats();
        alert('AI memory cleared!');
    }
}

// ========== EXPOSE FUNCTIONS GLOBALLY FOR HTML ONCLICK ==========
if (typeof window !== 'undefined') {
    window.newGame = newGame;
    window.undoMove = undoMove;
    window.switchSides = switchSides;
    window.changeGameMode = changeGameMode;
    window.setMode = function(mode) {
        if (mode === 'ai' || mode === 'player') {
            gameMode = mode;
            const gameModeSelect = document.getElementById('gameMode');
            if (gameModeSelect) gameModeSelect.value = mode;
            changeGameMode();
        }
    };
    
    window.clearAIMemory = clearMemory;
    window.getAIMemoryStats = () => moveTree ? moveTree.getStats() : { totalMoves: 0 };
    window.analyzeMove = window.analyzeMove;
}

console.log(`✅ Chess Game v${GAME_VERSION} loaded - Checkmate Knowledge + Anti-Endless Checks!`);
console.log(`🎯 AI now knows how to checkmate and avoids endless checks!`);
console.log(`💡 Type 'help()' for all commands, 'analyzeMove(\"e4d5\")' for move analysis!`);
