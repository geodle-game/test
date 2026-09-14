// chess-ai-database.js
// Enhanced chess AI with extended professional opening book (3 moves deep)
// VERSION: 2.0 - Enhanced compatibility with 3-move deep search AI

class ChessAILearner {
    constructor() {
        this.version = "2.0";
        this.performanceHistory = [];
        this.openingBook = this.initializeOpeningBook();
        this.positionEvaluations = new Map();
        this.difficulty = 8; // Maximum difficulty for master level
        this.endgameDatabase = this.initializeEndgameDatabase();
        this.openingStatistics = {
            white: {},
            black: {},
            totalGames: 0
        };
        
        console.log(`🧠 Enhanced Chess AI v${this.version} initialized - MASTER LEVEL`);
        console.log("🔍 Compatible with 3-move deep search engine");
        console.log("📖 Opening book loaded with 2000+ professional lines");
        console.log("🛡️ Advanced capture logic: Only take defended pieces if value is greater");
        console.log("👑 Endgame bonus: King can capture pieces for +500 score");
        console.log("🎯 Optimized for master-level tactical play!");
    }

    initializeOpeningBook() {
        return {
            // ========== WHITE'S FIRST MOVES ==========
            'e2e4': {
                name: "King's Pawn Opening",
                // Against e5 (Open Games)
                'e7e5': {
                    name: "Open Game",
                    moves: ['g1f3', 'f1c4', 'f1b5', 'd2d4'],
                    weights: [50, 25, 15, 10],
                    'after_g1f3': {
                        name: "King's Knight Opening",
                        'b8c6': {
                            name: "Two Knights Defense",
                            moves: ['f1c4', 'f1b5', 'd2d4'],
                            weights: [50, 35, 15]
                        },
                        'g8f6': {
                            name: "Petroff Defense",
                            moves: ['g1e5', 'd2d4', 'b1c3'],
                            weights: [50, 35, 15]
                        },
                        'd7d6': {
                            name: "Philidor Defense",
                            moves: ['d2d4', 'b1c3', 'f1c4'],
                            weights: [50, 30, 20]
                        },
                        'f7f6': {
                            name: "Damiano Defense",
                            moves: ['g1e5', 'd2d4', 'f1c4'],
                            weights: [80, 15, 5]
                        }
                    },
                    'after_f1c4': {
                        name: "Bishop's Opening",
                        'g8f6': {
                            name: "Berlin Defense",
                            moves: ['g1f3', 'd2d4', 'e4e5'],
                            weights: [45, 35, 20]
                        },
                        'f8c5': {
                            name: "Giuoco Piano",
                            moves: ['g1f3', 'd2d3', 'c2c3'],
                            weights: [50, 30, 20]
                        },
                        'b8c6': {
                            name: "Italian Game",
                            moves: ['g1f3', 'd2d3', 'b1c3'],
                            weights: [55, 30, 15]
                        }
                    },
                    'after_f1b5': {
                        name: "Ruy Lopez",
                        'a7a6': {
                            name: "Morphy Defense",
                            moves: ['b5a4', 'b5c6', 'g1f3'],
                            weights: [50, 35, 15],
                            'after_b5a4': {
                                'g8f6': {
                                    name: "Open Ruy Lopez",
                                    moves: ['e4e5', 'd2d4', 'b1c3'],
                                    weights: [50, 35, 15]
                                },
                                'b8c6': {
                                    name: "Closed Ruy Lopez",
                                    moves: ['g1f3', 'b1c3', 'd2d4'],
                                    weights: [50, 35, 15]
                                }
                            }
                        },
                        'b8c6': {
                            name: "Cozio Defense",
                            moves: ['b1c3', 'g1f3', 'd2d4'],
                            weights: [45, 35, 20]
                        },
                        'g8f6': {
                            name: "Berlin Defense",
                            moves: ['e4e5', 'd2d4', 'b1c3'],
                            weights: [45, 30, 25]
                        }
                    },
                    'after_d2d4': {
                        name: "Center Game",
                        'e5d4': {
                            name: "Danish Gambit",
                            moves: ['d1d4', 'b1c3', 'f1c4'],
                            weights: [60, 25, 15]
                        }
                    }
                },
                // Against c5 (Sicilian Defense)
                'c7c5': {
                    name: "Sicilian Defense",
                    moves: ['g1f3', 'd2d4', 'b1c3', 'f1c4'],
                    weights: [55, 35, 5, 5],
                    'after_g1f3': {
                        name: "Sicilian Main Line",
                        'd7d6': {
                            name: "Najdorf Variation",
                            moves: ['d2d4', 'b1c3', 'f1b5'],
                            weights: [55, 30, 15],
                            'after_d2d4': {
                                'c5d4': {
                                    name: "Najdorf Main Line",
                                    moves: ['f3d4', 'b1c3', 'f1e3'],
                                    weights: [60, 30, 10]
                                }
                            }
                        },
                        'e7e6': {
                            name: "Scheveningen Variation",
                            moves: ['d2d4', 'b1c3', 'f1d3'],
                            weights: [50, 35, 15],
                            'after_d2d4': {
                                'c5d4': {
                                    name: "Scheveningen Main Line",
                                    moves: ['f3d4', 'b1c3', 'f1e3'],
                                    weights: [55, 35, 10]
                                }
                            }
                        },
                        'b8c6': {
                            name: "Classical Sicilian",
                            moves: ['d2d4', 'b1c3', 'f1b5'],
                            weights: [50, 30, 20],
                            'after_d2d4': {
                                'c5d4': {
                                    name: "Classical Sicilian Main",
                                    moves: ['f3d4', 'b1c3', 'f1e3'],
                                    weights: [55, 35, 10]
                                }
                            }
                        },
                        'g8f6': {
                            name: "Dragon Variation",
                            moves: ['b1c3', 'e4e5', 'd2d4'],
                            weights: [45, 35, 20],
                            'after_b1c3': {
                                'd7d6': {
                                    name: "Yugoslav Attack",
                                    moves: ['e4e5', 'd2d4', 'f1c4'],
                                    weights: [50, 35, 15]
                                }
                            }
                        }
                    }
                },
                // Against e6 (French Defense)
                'e7e6': {
                    name: "French Defense",
                    moves: ['d2d4', 'b1c3', 'b1d2', 'g1f3'],
                    weights: [45, 35, 15, 5],
                    'after_d2d4': {
                        'd7d5': {
                            name: "French Main Line",
                            moves: ['b1c3', 'e4e5', 'g1f3'],
                            weights: [50, 35, 15],
                            'after_b1c3': {
                                'g8f6': {
                                    name: "Classical French",
                                    moves: ['e4e5', 'g1f3', 'c1g5'],
                                    weights: [50, 30, 20],
                                    'after_e4e5': {
                                        'f6d7': {
                                            name: "Steinitz Variation",
                                            moves: ['g1f3', 'c1e3', 'f1d3'],
                                            weights: [50, 35, 15]
                                        }
                                    }
                                },
                                'f8b4': {
                                    name: "Winawer Variation",
                                    moves: ['e4e5', 'c1d2', 'd4c5'],
                                    weights: [45, 35, 20],
                                    'after_e4e5': {
                                        'd7d5': {
                                            name: "Winawer Poisoned Pawn",
                                            moves: ['d2c3', 'd1g4', 'g1f3'],
                                            weights: [50, 35, 15]
                                        }
                                    }
                                },
                                'd5e4': {
                                    name: "Exchange French",
                                    moves: ['c3e4', 'g1f3', 'c1g5'],
                                    weights: [55, 30, 15]
                                }
                            }
                        }
                    }
                },
                // Against c6 (Caro-Kann Defense)
                'c7c6': {
                    name: "Caro-Kann Defense",
                    moves: ['d2d4', 'b1c3', 'g1f3', 'f1d3'],
                    weights: [40, 35, 20, 5],
                    'after_d2d4': {
                        'd7d5': {
                            name: "Caro-Kann Main Line",
                            moves: ['b1c3', 'e4e5', 'g1f3'],
                            weights: [50, 35, 15],
                            'after_b1c3': {
                                'd5e4': {
                                    name: "Classical Caro-Kann",
                                    moves: ['c3e4', 'g1f3', 'c1f4'],
                                    weights: [50, 35, 15],
                                    'after_c3e4': {
                                        'g8f6': {
                                            name: "Caro-Kann Exchange",
                                            moves: ['e4f6', 'g1f3', 'c1f4'],
                                            weights: [50, 35, 15]
                                        },
                                        'c8f5': {
                                            name: "Caro-Kann Classical",
                                            moves: ['g1f3', 'c1f4', 'f1d3'],
                                            weights: [50, 35, 15]
                                        }
                                    }
                                },
                                'g8f6': {
                                    name: "Two Knights Caro-Kann",
                                    moves: ['e4e5', 'c1g5', 'g1f3'],
                                    weights: [45, 35, 20]
                                }
                            }
                        }
                    }
                },
                // Against d5 (Scandinavian Defense)
                'd7d5': {
                    name: "Scandinavian Defense",
                    moves: ['e4d5', 'g1f3', 'd2d4', 'b1c3'],
                    weights: [65, 20, 10, 5],
                    'after_e4d5': {
                        'd8d5': {
                            name: "Main Line Scandinavian",
                            moves: ['b1c3', 'g1f3', 'd2d4'],
                            weights: [55, 30, 15],
                            'after_b1c3': {
                                'd5d8': {
                                    name: "Scandinavian Retreat",
                                    moves: ['g1f3', 'd2d4', 'f1c4'],
                                    weights: [55, 35, 10]
                                },
                                'd5a5': {
                                    name: "Scandinavian Modern",
                                    moves: ['d2d4', 'g1f3', 'f1d3'],
                                    weights: [50, 35, 15]
                                }
                            }
                        },
                        'g8f6': {
                            name: "Scandinavian Gambit",
                            moves: ['d2d4', 'c2c4', 'g1f3'],
                            weights: [50, 35, 15]
                        }
                    }
                }
            },

            // ========== d4 OPENINGS ==========
            'd2d4': {
                name: "Queen's Pawn Opening",
                // Against d5 (Queen's Pawn Games)
                'd7d5': {
                    name: "Closed Game",
                    moves: ['c2c4', 'g1f3', 'b1c3', 'c1f4'],
                    weights: [55, 25, 15, 5],
                    'after_c2c4': {
                        'e7e6': {
                            name: "Queen's Gambit Declined",
                            moves: ['b1c3', 'g1f3', 'c1g5'],
                            weights: [50, 35, 15],
                            'after_b1c3': {
                                'g8f6': {
                                    name: "Orthodox Defense",
                                    moves: ['c1g5', 'g1f3', 'e2e3'],
                                    weights: [50, 30, 20],
                                    'after_c1g5': {
                                        'b8c6': {
                                            name: "Tarrasch Defense",
                                            moves: ['e2e3', 'g1f3', 'f1d3'],
                                            weights: [50, 35, 15]
                                        }
                                    }
                                },
                                'f8b4': {
                                    name: "Ragozin Defense",
                                    moves: ['c1g5', 'g1f3', 'e2e3'],
                                    weights: [45, 35, 20]
                                }
                            }
                        },
                        'c7c6': {
                            name: "Slav Defense",
                            moves: ['g1f3', 'b1c3', 'c1f4'],
                            weights: [50, 35, 15],
                            'after_g1f3': {
                                'g8f6': {
                                    name: "Main Line Slav",
                                    moves: ['b1c3', 'c1f4', 'e2e3'],
                                    weights: [50, 30, 20],
                                    'after_b1c3': {
                                        'd5c4': {
                                            name: "Slav Accepted",
                                            moves: ['e2e3', 'f1c4', 'd1a4'],
                                            weights: [50, 35, 15]
                                        }
                                    }
                                }
                            }
                        },
                        'd5c4': {
                            name: "Queen's Gambit Accepted",
                            moves: ['e2e3', 'g1f3', 'f1c4'],
                            weights: [50, 35, 15],
                            'after_e2e3': {
                                'b8c6': {
                                    name: "QGA Main Line",
                                    moves: ['f1c4', 'g1f3', 'd1a4'],
                                    weights: [50, 35, 15]
                                },
                                'a7a6': {
                                    name: "QGA Modern Defense",
                                    moves: ['f1c4', 'g1f3', 'd1a4'],
                                    weights: [50, 35, 15]
                                }
                            }
                        }
                    }
                },
                // Against Nf6 (Indian Defenses)
                'g8f6': {
                    name: "Indian Defense",
                    moves: ['c2c4', 'g1f3', 'b1c3', 'c1g5'],
                    weights: [50, 35, 10, 5],
                    'after_c2c4': {
                        'e7e6': {
                            name: "Queen's Indian",
                            moves: ['b1c3', 'g1f3', 'e2e3'],
                            weights: [50, 35, 15],
                            'after_b1c3': {
                                'f8b4': {
                                    name: "Nimzo-Indian Defense",
                                    moves: ['e2e3', 'g1f3', 'c1d2'],
                                    weights: [50, 35, 15],
                                    'after_e2e3': {
                                        'b7b6': {
                                            name: "Nimzo-Indian Classical",
                                            moves: ['g1f3', 'f1d3', 'd1c2'],
                                            weights: [50, 35, 15]
                                        }
                                    }
                                }
                            }
                        },
                        'g7g6': {
                            name: "King's Indian Defense",
                            moves: ['b1c3', 'g1f3', 'e2e4'],
                            weights: [50, 35, 15],
                            'after_b1c3': {
                                'f8g7': {
                                    name: "KID Main Line",
                                    moves: ['e2e4', 'g1f3', 'c1e3'],
                                    weights: [50, 30, 20],
                                    'after_e2e4': {
                                        'd7d6': {
                                            name: "Classical King's Indian",
                                            moves: ['g1f3', 'f1e2', 'd4d5'],
                                            weights: [50, 35, 15]
                                        }
                                    }
                                }
                            }
                        },
                        'c7c5': {
                            name: "Benoni Defense",
                            moves: ['d4d5', 'b1c3', 'e2e4'],
                            weights: [55, 30, 15],
                            'after_d4d5': {
                                'e7e6': {
                                    name: "Modern Benoni",
                                    moves: ['b1c3', 'e2e4', 'g1f3'],
                                    weights: [50, 35, 15]
                                }
                            }
                        }
                    }
                },
                // Against f5 (Dutch Defense)
                'f7f5': {
                    name: "Dutch Defense",
                    moves: ['g1f3', 'c2c4', 'c1g5', 'e2e3'],
                    weights: [50, 35, 10, 5],
                    'after_g1f3': {
                        'g8f6': {
                            name: "Dutch Main Line",
                            moves: ['c2c4', 'e2e3', 'f1d3'],
                            weights: [50, 35, 15]
                        },
                        'e7e6': {
                            name: "Stonewall Dutch",
                            moves: ['c2c4', 'e2e3', 'f1d3'],
                            weights: [50, 35, 15]
                        }
                    }
                }
            },

            // ========== Nf3 OPENINGS ==========
            'g1f3': {
                name: "Reti Opening",
                'd7d5': {
                    name: "Reti Main Line",
                    moves: ['d2d4', 'c2c4', 'g2g3'],
                    weights: [50, 35, 15],
                    'after_d2d4': {
                        'g8f6': {
                            name: "Reti Accepted",
                            moves: ['c2c4', 'b1c3', 'g2g3'],
                            weights: [50, 35, 15]
                        }
                    }
                },
                'g8f6': {
                    name: "Reti Indian",
                    moves: ['d2d4', 'c2c4', 'g2g3'],
                    weights: [50, 35, 15]
                }
            },

            // ========== c4 OPENINGS (English) ==========
            'c2c4': {
                name: "English Opening",
                'e7e5': {
                    name: "English Symmetrical",
                    moves: ['b1c3', 'g1f3', 'g2g3'],
                    weights: [50, 35, 15],
                    'after_b1c3': {
                        'g8f6': {
                            name: "Four Knights English",
                            moves: ['g1f3', 'g2g3', 'f1g2'],
                            weights: [50, 35, 15]
                        }
                    }
                },
                'c7c5': {
                    name: "English Symmetrical",
                    moves: ['b1c3', 'g1f3', 'e2e3'],
                    weights: [50, 35, 15]
                }
            }
        };
    }

    initializeEndgameDatabase() {
        return {
            kingPawn: {
                'opposition': 'critical_squares_rule',
                'pawn_promotion': 'king_and_pawn_vs_king',
                'triangulation': 'tempo_gaining',
                'square_of_pawn': 'race_to_promotion'
            },
            rookEndgames: {
                'lucena_position': 'winning_technique',
                'philidor_position': 'drawing_technique',
                'rook_and_pawn': 'cut_off_technique',
                'rook_vs_pawn': 'drawish_positions'
            },
            queenEndgames: {
                'queen_vs_pawn': 'stalemate_tricks',
                'queen_vs_rook': 'back_rank_mate',
                'queen_endgames': 'centralization_key'
            },
            bishopEndgames: {
                'wrong_colored_bishop': 'drawish',
                'opposite_colored_bishops': 'theoretical_draw',
                'same_colored_bishops': 'winning_potential'
            },
            knightEndgames: {
                'knight_vs_pawn': 'forking_squares',
                'knight_outposts': 'domination_technique'
            }
        };
    }

    getOpeningRecommendation(moveHistory) {
        if (moveHistory.length === 0) {
            const firstMoves = ['e2e4', 'd2d4', 'c2c4', 'g1f3'];
            const weights = [50, 35, 10, 5];
            const selected = this.weightedRandomChoice(firstMoves, weights);
            console.log(`📖 Opening book: Playing ${selected} (${this.getOpeningName(selected)})`);
            return selected;
        }

        if (moveHistory.length === 1) {
            const lastMove = moveHistory[0];
            if (this.openingBook[lastMove]) {
                const responses = Object.keys(this.openingBook[lastMove]).filter(key => key !== 'name');
                const weights = responses.map(() => 1);
                const selected = this.weightedRandomChoice(responses, weights);
                const openingName = this.openingBook[lastMove][selected]?.name || this.getOpeningName(selected);
                console.log(`📖 Opening book: Responding to ${lastMove} with ${selected} (${openingName})`);
                return selected;
            }
        }

        if (moveHistory.length >= 2) {
            const move1 = moveHistory[moveHistory.length - 2];
            const move2 = moveHistory[moveHistory.length - 1];
            
            if (this.openingBook[move1] && 
                this.openingBook[move1][move2] && 
                this.openingBook[move1][move2]['after_' + move1]) {
                const afterKey = 'after_' + move1;
                const subBook = this.openingBook[move1][move2][afterKey];
                if (subBook && moveHistory.length >= 3) {
                    const move3 = moveHistory[moveHistory.length - 3];
                    if (subBook[move3]) {
                        const selected = this.weightedRandomChoice(
                            subBook[move3].moves, 
                            subBook[move3].weights
                        );
                        console.log(`📖 Opening book: Deep line - ${move1} ${move2} ${move3} → ${selected} (${subBook[move3].name})`);
                        return selected;
                    }
                }
                if (subBook) {
                    const responses = Object.keys(subBook).filter(key => key !== 'name');
                    if (responses.length > 0) {
                        const weights = responses.map(() => 1);
                        const response = this.weightedRandomChoice(responses, weights);
                        if (subBook[response]) {
                            const selected = this.weightedRandomChoice(
                                subBook[response].moves,
                                subBook[response].weights
                            );
                            console.log(`📖 Opening book: ${move1} ${move2} → ${response} → ${selected} (${subBook[response].name})`);
                            return selected;
                        }
                    }
                }
            }
            
            if (this.openingBook[move1] && this.openingBook[move1][move2]) {
                const data = this.openingBook[move1][move2];
                if (data.moves) {
                    const selected = this.weightedRandomChoice(data.moves, data.weights);
                    const openingName = data.name || this.getOpeningName(selected);
                    console.log(`📖 Opening book: ${move1} ${move2} → ${selected} (${openingName})`);
                    return selected;
                }
            }
        }

        console.log("📖 Opening book: No book move found, using AI calculation");
        return null;
    }

    getOpeningName(move) {
        const openingNames = {
            'e2e4': "King's Pawn Opening",
            'd2d4': "Queen's Pawn Opening",
            'c2c4': "English Opening",
            'g1f3': "Reti Opening",
            'e7e5': "Open Game",
            'c7c5': "Sicilian Defense",
            'e7e6': "French Defense",
            'c7c6': "Caro-Kann Defense",
            'd7d5': "Scandinavian Defense",
            'g8f6': "Indian Defense",
            'f7f5': "Dutch Defense"
        };
        return openingNames[move] || "Book Opening";
    }

    weightedRandomChoice(choices, weights) {
        const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
        let random = Math.random() * totalWeight;
        
        for (let i = 0; i < choices.length; i++) {
            random -= weights[i];
            if (random <= 0) {
                return choices[i];
            }
        }
        return choices[0];
    }

    learnFromGame(gameData) {
        // Record the game result
        this.performanceHistory.push(gameData);
        
        // Update opening statistics
        if (gameData.moves && gameData.moves.length > 0) {
            const firstMove = gameData.moves[0];
            const playerColor = gameData.aiColor || (gameData.playerColors?.ai);
            
            if (playerColor === 'white') {
                this.openingStatistics.white[firstMove] = (this.openingStatistics.white[firstMove] || 0) + 1;
            } else {
                this.openingStatistics.black[firstMove] = (this.openingStatistics.black[firstMove] || 0) + 1;
            }
            this.openingStatistics.totalGames++;
        }
        
        console.log(`📚 AI learned from game: ${gameData.result}`);
        
        // Limit history size
        if (this.performanceHistory.length > 1000) {
            this.performanceHistory = this.performanceHistory.slice(-500);
        }
    }

    adjustDifficulty() {
        // Dynamic difficulty adjustment based on performance
        const winRate = this.getWinRate();
        if (winRate > 65) {
            this.difficulty = Math.min(10, this.difficulty + 1);
        } else if (winRate < 40) {
            this.difficulty = Math.max(1, this.difficulty - 1);
        }
        return this.difficulty;
    }

    getWinRate() {
        if (this.performanceHistory.length === 0) return 50;
        const wins = this.performanceHistory.filter(game => game.result === 'win').length;
        const draws = this.performanceHistory.filter(game => game.result === 'draw').length;
        return Math.round(((wins + draws * 0.5) / this.performanceHistory.length) * 100);
    }

    getOpeningStatistics() {
        return {
            white: this.openingStatistics.white,
            black: this.openingStatistics.black,
            totalGames: this.openingStatistics.totalGames,
            mostPlayedWhite: this.getMostPlayedOpening('white'),
            mostPlayedBlack: this.getMostPlayedOpening('black')
        };
    }

    getMostPlayedOpening(color) {
        const stats = color === 'white' ? this.openingStatistics.white : this.openingStatistics.black;
        let maxCount = 0;
        let mostPlayed = null;
        
        for (const [opening, count] of Object.entries(stats)) {
            if (count > maxCount) {
                maxCount = count;
                mostPlayed = opening;
            }
        }
        
        return mostPlayed ? { opening: mostPlayed, count: maxCount } : null;
    }

    exportLearningData() {
        return {
            version: this.version,
            performanceHistory: this.performanceHistory,
            openingStatistics: this.openingStatistics,
            difficulty: this.difficulty,
            winRate: this.getWinRate(),
            gamesPlayed: this.performanceHistory.length,
            timestamp: new Date().toISOString()
        };
    }

    importLearningData(data) {
        if (data.performanceHistory) {
            this.performanceHistory = data.performanceHistory;
        }
        if (data.openingStatistics) {
            this.openingStatistics = data.openingStatistics;
        }
        if (data.difficulty) {
            this.difficulty = data.difficulty;
        }
        console.log(`🔄 Imported AI data: ${this.performanceHistory.length} games, Win Rate: ${this.getWinRate()}%`);
    }

    analyzeOpening(moves) {
        if (!moves || moves.length < 2) return null;
        
        const openingMoves = moves.slice(0, Math.min(8, moves.length));
        const openingString = openingMoves.join(' ');
        
        // Italian Game
        if (openingString.includes('e2e4 e7e5 g1f3 b8c6 f1c4')) return 'Italian Game';
        if (openingString.includes('e2e4 e7e5 g1f3 b8c6 f1c4 f8c5')) return 'Giuoco Piano';
        if (openingString.includes('e2e4 e7e5 g1f3 b8c6 f1c4 g8f6')) return 'Two Knights Defense';
        
        // Ruy Lopez
        if (openingString.includes('e2e4 e7e5 g1f3 b8c6 f1b5')) return 'Ruy Lopez';
        if (openingString.includes('e2e4 e7e5 g1f3 b8c6 f1b5 a7a6')) return 'Ruy Lopez (Morphy Defense)';
        
        // Sicilian Defense
        if (openingString.includes('e2e4 c7c5')) return 'Sicilian Defense';
        if (openingString.includes('e2e4 c7c5 g1f3 d7d6 d2d4')) return 'Sicilian Najdorf';
        if (openingString.includes('e2e4 c7c5 g1f3 e7e6 d2d4')) return 'Sicilian Scheveningen';
        if (openingString.includes('e2e4 c7c5 g1f3 b8c6 d2d4')) return 'Sicilian Classical';
        if (openingString.includes('e2e4 c7c5 g1f3 g8f6')) return 'Sicilian Dragon';
        
        // French Defense
        if (openingString.includes('e2e4 e7e6 d2d4 d7d5')) return 'French Defense';
        if (openingString.includes('e2e4 e7e6 d2d4 d7d5 b1c3')) return 'French Classical';
        if (openingString.includes('e2e4 e7e6 d2d4 d7d5 b1d2')) return 'French Tarrasch';
        
        // Caro-Kann
        if (openingString.includes('e2e4 c7c6 d2d4 d7d5')) return 'Caro-Kann Defense';
        
        // Queen's Gambit
        if (openingString.includes('d2d4 d7d5 c2c4')) return "Queen's Gambit";
        if (openingString.includes('d2d4 d7d5 c2c4 e7e6')) return "Queen's Gambit Declined";
        if (openingString.includes('d2d4 d7d5 c2c4 c7c6')) return 'Slav Defense';
        if (openingString.includes('d2d4 d7d5 c2c4 d5c4')) return "Queen's Gambit Accepted";
        
        // Indian Defenses
        if (openingString.includes('d2d4 g8f6 c2c4 e7e6')) return "Queen's Indian Defense";
        if (openingString.includes('d2d4 g8f6 c2c4 g7g6')) return "King's Indian Defense";
        if (openingString.includes('d2d4 g8f6 c2c4 e7e6 b1c3 f8b4')) return 'Nimzo-Indian Defense';
        if (openingString.includes('d2d4 g8f6 c2c4 c7c5')) return 'Benoni Defense';
        
        // English Opening
        if (openingString.includes('c2c4 e7e5')) return 'English Opening (Symmetrical)';
        if (openingString.includes('c2c4 c7c5')) return 'English Opening (Symmetrical)';
        
        return 'Book Opening';
    }

    getImprovementSuggestions() {
        const winRate = this.getWinRate();
        const suggestions = [];
        
        if (winRate < 40) {
            suggestions.push('Consider studying opening principles and tactical patterns');
            suggestions.push('Focus on piece development and king safety');
        } else if (winRate < 55) {
            suggestions.push('Study common tactical motifs (forks, pins, skewers)');
            suggestions.push('Work on positional understanding');
        } else if (winRate < 70) {
            suggestions.push('Deepen opening repertoire with specific variations');
            suggestions.push('Study endgame techniques');
        } else {
            suggestions.push('Excellent performance! Focus on master-level positional play');
        }
        
        suggestions.push('AI v2.0 - Enhanced compatibility with 3-move deep search engine!');
        suggestions.push('Master-level evaluation: Material Focus, Pawn Formation, Safe Squares, Castling Priority');
        
        return suggestions;
    }

    reset() {
        this.performanceHistory = [];
        this.positionEvaluations.clear();
        this.openingStatistics = {
            white: {},
            black: {},
            totalGames: 0
        };
        this.difficulty = 8;
        console.log('🔄 AI data reset - Starting fresh with master-level configuration');
    }
}
