// Game State
const gameState = {
    deck: [],
    player: {
        hand: [],
        faceUp: [],
        faceDown: [],
        score: 0,
        tricksWon: 0,
        wonTricks: []
    },
    computer: {
        hand: [],
        faceUp: [],
        faceDown: [],
        score: 0,
        tricksWon: 0,
        wonTricks: []
    },
    trumpSuit: null,
    currentPlayer: null,
    trick: {
        cards: [],
        leadSuit: null
    },
    gameStarted: false,
    gamePhase: 'setup', // 'setup', 'coin-toss', 'trump-selection', 'dealing-remaining', 'playing'
    gameOver: false,
    trickCount: 0,
    lastRoundWinner: null,
    resolvingTrick: false,
    lastTrumpSelector: null,
    computerThinking: false,
    roundNumber: 1,
    difficulty: 'medium', // 'easy', 'medium', 'hard'
    playedCards: [], // Track all played cards for Hard mode
    coinTossWinner: null, // Who won the coin toss
    isFirstRound: true // Track if this is the first round (for coin toss)
};

// ---------------------------------------------------------------------------
// Engine <-> presentation boundary
// ---------------------------------------------------------------------------
// The engine owns state and rules. It never touches the DOM and never decides how
// long anything takes: everything the player sees goes through GameView
// (presentation.js), and game flow advances by awaiting "beats" - Promises that
// the view resolves when the matching presentation moment is over.
//
// flowSession is bumped by restartGame() so continuations that belong to the old
// game are dropped instead of firing into the new one.
let flowSession = 0;

function runBeat(beat, payload, next) {
    const session = flowSession;
    GameView.beat(beat, payload).then(() => {
        if (session !== flowSession) return; // cancelled by restartGame()
        next();
    }).catch(err => console.error(`Game flow error after beat "${beat}":`, err));
}

function addToLog(message, type = '') { GameView.log(message, type); }
function clearLog() { GameView.clearLog(); }
function showStatus(message) { GameView.status(message); }
function showThinking(show) { GameView.thinking(show); }
function updateDisplay() { GameView.render(); }
function highlightTrickWinner(winner) { GameView.highlightTrickWinner(winner); }
function showGameOver(winner) {
    GameView.showGameOver(winner, { player: gameState.player.score, computer: gameState.computer.score });
}

// Card creation and deck setup
function createDeck() {
    const suits = ['hearts', 'diamonds', 'clubs', 'spades'];
    const ranks = ['8', '9', '10', 'J', 'Q', 'K', 'A'];
    const deck = [];
    
    // Add standard cards (8-A)
    suits.forEach(suit => {
        ranks.forEach(rank => {
            deck.push(`${rank}_${suit}`);
        });
    });
    
    // Add special 7s
    deck.push('7_hearts');
    deck.push('7_spades');
    
    return deck;
}

function shuffleDeck(deck) {
    const shuffled = [...deck];
    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
}

function dealInitialCards() {
    gameState.deck = shuffleDeck(createDeck());
    let cardIndex = 0;
    
    // Reset all cards
    gameState.player.hand = [];
    gameState.player.faceUp = [];
    gameState.player.faceDown = [];
    gameState.computer.hand = [];
    gameState.computer.faceUp = [];
    gameState.computer.faceDown = [];
    
    // Deal ONLY 5 hand cards first (for trump selection)
    for (let i = 0; i < 5; i++) {
        gameState.player.hand.push(gameState.deck[cardIndex++]);
        gameState.computer.hand.push(gameState.deck[cardIndex++]);
    }
    
    // Store remaining cards for later dealing
    gameState.remainingCards = gameState.deck.slice(cardIndex);
}

function dealRemainingCards() {
    let cardIndex = 0;
    
    // Deal face-down cards
    for (let i = 0; i < 5; i++) {
        gameState.player.faceDown.push(gameState.remainingCards[cardIndex++]);
        gameState.computer.faceDown.push(gameState.remainingCards[cardIndex++]);
    }
    
    // Deal face-up cards
    for (let i = 0; i < 5; i++) {
        gameState.player.faceUp.push(gameState.remainingCards[cardIndex++]);
        gameState.computer.faceUp.push(gameState.remainingCards[cardIndex++]);
    }
    
    // Clear remaining cards
    gameState.remainingCards = [];
}

// Card utility functions
function getCardSuit(card) {
    return card.split('_')[1];
}

function getCardRank(card) {
    return card.split('_')[0];
}

function getCardValue(card) {
    const rank = getCardRank(card);
    const values = { '7': 7, '8': 8, '9': 9, '10': 10, 'J': 11, 'Q': 12, 'K': 13, 'A': 14 };
    return values[rank] || 0;
}

function getSuitSymbol(suit) {
    const symbols = {
        'hearts': '♥',
        'diamonds': '♦',
        'clubs': '♣',
        'spades': '♠'
    };
    return symbols[suit];
}

// Card validation
function isValidPlay(card, leadSuit) {
    if (!leadSuit) return true; // Leading player can play any card
    
    const currentPlayerData = gameState.currentPlayer === 'player' ? gameState.player : gameState.computer;
    
    // ONLY check hand and face-up cards (NOT face-down cards)
    const visibleCards = [
        ...currentPlayerData.hand.filter(c => c !== null),
        ...currentPlayerData.faceUp.filter(c => c !== null)
    ];
    
    // Check if player has any cards of the lead suit in VISIBLE cards only
    const hasLeadSuit = visibleCards.some(c => getCardSuit(c) === leadSuit);
    
    const cardSuit = getCardSuit(card);
    
    if (hasLeadSuit) {
        // Must follow suit if possible (with visible cards)
        return cardSuit === leadSuit;
    } else {
        // Can play any card if void in lead suit (based on visible cards only)
        return true;
    }
}


function getValidCards(playerData) {
    const cards = [];
    const leadSuit = gameState.trick.leadSuit;
    
    // Add hand cards
    playerData.hand.forEach((card, index) => {
        if (card && isValidPlay(card, leadSuit)) {
            cards.push({ card, source: 'hand', index });
        }
    });
    
    // Add face-up cards
    playerData.faceUp.forEach((card, index) => {
        if (card && isValidPlay(card, leadSuit)) {
            cards.push({ card, source: 'faceUp', index });
        }
    });
    
    return cards;
}

// Card playing mechanics
function revealFaceDownCard(playerData, index) {
    if (playerData.faceDown[index]) {
        // Move face-down card to face-up position
        playerData.faceUp[index] = playerData.faceDown[index];
        playerData.faceDown[index] = null;
        updateDisplay();
    }
}

function playCard(cardIndex, source) {
    if (gameState.resolvingTrick || gameState.currentPlayer !== 'player' || gameState.gamePhase !== 'playing') {
        return false;
    }
    
    const currentPlayerData = gameState.player;
    let card;
    
    if (source === 'hand') {
        card = currentPlayerData.hand[cardIndex];
        if (!card) return false;
    } else if (source === 'faceUp') {
        card = currentPlayerData.faceUp[cardIndex];
        if (!card) return false;
    }
    
    // FIXED VALIDATION - Only check visible cards
    if (gameState.trick.leadSuit) {
        const visibleCards = [
            ...currentPlayerData.hand.filter(c => c !== null),
            ...currentPlayerData.faceUp.filter(c => c !== null)
        ];
        
        const hasLeadSuit = visibleCards.some(c => getCardSuit(c) === gameState.trick.leadSuit);
        const cardSuit = getCardSuit(card);
        
        if (hasLeadSuit && cardSuit !== gameState.trick.leadSuit) {
            showStatus("Invalid play! You must follow suit if possible.");
            addToLog("Invalid play! You must follow suit if possible.");
            return false; // Don't remove the card, just reject the play
        }
    }
    
    // Valid play - remove the card and proceed
    if (source === 'hand') {
        currentPlayerData.hand[cardIndex] = null;
    } else if (source === 'faceUp') {
        currentPlayerData.faceUp[cardIndex] = null;
        // Reveal the face-down card beneath
        revealFaceDownCard(currentPlayerData, cardIndex);
    }
    
    // Log the play
    const cardDisplay = `${getCardRank(card)}${getSuitSymbol(getCardSuit(card))}`;
    addToLog(`You played ${cardDisplay}`);
    
    // Add card to current trick
    gameState.trick.cards.push({
        card: card,
        player: gameState.currentPlayer
    });
    
    // Set lead suit if this is the first card
    if (gameState.trick.cards.length === 1) {
        gameState.trick.leadSuit = getCardSuit(card);
    }
    
    updateDisplay();
    
    // Check if trick is complete
    if (gameState.trick.cards.length === 2) {
        gameState.resolvingTrick = true;
        runBeat('trick-complete', {}, resolveTrick);
    } else {
        // Switch to computer
        gameState.currentPlayer = 'computer';
        showStatus("Computer is playing...");
        runBeat('computer-response', {}, computerPlay);
    }
    
    return true;
}


// Computer AI
function selectComputerTrump() {
    const suitCounts = { hearts: 0, diamonds: 0, clubs: 0, spades: 0 };
    const highCards = { hearts: 0, diamonds: 0, clubs: 0, spades: 0 };
    
    // Analyze ONLY hand cards (not face-up cards during trump selection)
    gameState.computer.hand.forEach(card => {
        if (!card) return;
        const suit = getCardSuit(card);
        if (suitCounts.hasOwnProperty(suit)) {
            suitCounts[suit]++;
            
            // Count high cards (J, Q, K, A)
            const rank = getCardRank(card);
            if (['J', 'Q', 'K', 'A'].includes(rank)) {
                highCards[suit]++;
            }
        }
    });
    
    // Select suit with best combination of high cards and length
    let bestSuit = 'hearts';
    let bestScore = -1;
    
    Object.keys(suitCounts).forEach(suit => {
        const score = highCards[suit] * 2 + suitCounts[suit];
        if (score > bestScore) {
            bestScore = score;
            bestSuit = suit;
        }
    });
    
    setTrump(bestSuit);
}

// Helper function for Hard AI - get remaining cards in a suit
function getRemainingCardsInSuit(suit) {
    const allCardsInSuit = [];
    const ranks = ['7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
    
    // Only 7 of hearts and spades exist
    if (suit === 'hearts' || suit === 'spades') {
        ranks.forEach(rank => allCardsInSuit.push(`${rank}_${suit}`));
    } else {
        // No 7 for diamonds and clubs
        ranks.filter(r => r !== '7').forEach(rank => allCardsInSuit.push(`${rank}_${suit}`));
    }
    
    // Filter out played cards
    return allCardsInSuit.filter(card => !gameState.playedCards.includes(card));
}

// Helper function for Hard AI - check if a card is the highest remaining in its suit
function isHighestRemaining(card) {
    const suit = getCardSuit(card);
    const value = getCardValue(card);
    const remaining = getRemainingCardsInSuit(suit);
    
    // Check if any remaining card (not played) has higher value
    for (const c of remaining) {
        if (getCardValue(c) > value && c !== card) {
            return false;
        }
    }
    return true;
}

// Helper function for Hard AI - get all remaining cards not yet played or visible
function getAllRemainingCards() {
    const suits = ['hearts', 'diamonds', 'clubs', 'spades'];
    let remaining = [];
    
    suits.forEach(suit => {
        remaining = remaining.concat(getRemainingCardsInSuit(suit));
    });
    
    return remaining;
}

function getComputerPlay() {
    const validCards = getValidCards(gameState.computer);
    if (validCards.length === 0) return null;
    
    // Route to appropriate AI based on difficulty
    switch(gameState.difficulty) {
        case 'easy':
            return getEasyAIPlay(validCards);
        case 'hard':
            return getHardAIPlay(validCards);
        default:
            return getMediumAIPlay(validCards);
    }
}

// EASY AI - Makes random choices, sometimes suboptimal
function getEasyAIPlay(validCards) {
    // 40% chance to just play randomly
    if (Math.random() < 0.4) {
        return validCards[Math.floor(Math.random() * validCards.length)];
    }
    
    // Otherwise play a simple strategy - just play lowest or highest randomly
    if (Math.random() < 0.5) {
        return validCards.reduce((lowest, card) =>
            getCardValue(card.card) < getCardValue(lowest.card) ? card : lowest
        );
    } else {
        return validCards.reduce((highest, card) =>
            getCardValue(card.card) > getCardValue(highest.card) ? card : highest
        );
    }
}

// MEDIUM AI - Current behavior (analyzes face-up cards)
function getMediumAIPlay(validCards) {
    const playerFaceUp = gameState.player.faceUp.filter(c => c);

    // Computer is leading the trick
    if (!gameState.trick.leadSuit) {
        // First, try to lead with an Ace that is likely to win (player doesn't show Ace in that suit)
        let highWinCard = validCards.find(cardObj => {
            const suit = getCardSuit(cardObj.card);
            const value = getCardValue(cardObj.card);
            // Player's face-up cards of this suit
            const playerFaceValues = playerFaceUp.filter(c => getCardSuit(c) === suit)
                                                 .map(c => getCardValue(c));
            // It's an Ace and player has no Ace in this suit visible
            return value === 14 && !playerFaceValues.includes(14);
        });
        if (highWinCard) return highWinCard;

        // Otherwise try safe low cards in suits where player shows strong cards
        let safeSuitCards = validCards.filter(cardObj => {
            const suit = getCardSuit(cardObj.card);
            const playerMax = Math.max(...playerFaceUp.filter(c => getCardSuit(c) === suit)
                                                 .map(c => getCardValue(c)), 0);
            return getCardValue(cardObj.card) < playerMax || playerMax === 0;
        });
        if (safeSuitCards.length) {
            return safeSuitCards.reduce((lowest, card) =>
                getCardValue(card.card) < getCardValue(lowest.card) ? card : lowest
            );
        }
        // Otherwise play lowest card available
        return validCards.reduce((lowest, card) =>
            getCardValue(card.card) < getCardValue(lowest.card) ? card : lowest
        );
    }

    // Computer is following the trick
    const leadSuit = gameState.trick.leadSuit;
    const humanCard = gameState.trick.cards[0].card;
    const humanCardValue = getCardValue(humanCard);

    const leadSuitCards = validCards.filter(card => getCardSuit(card.card) === leadSuit);
    const trumpCards = validCards.filter(card => getCardSuit(card.card) === gameState.trumpSuit);

    if (leadSuitCards.length > 0) {
        // Can computer win the trick by playing a higher card?
        const winningCards = leadSuitCards.filter(cardObj =>
            getCardValue(cardObj.card) > humanCardValue
        );
        if (winningCards.length) {
            // Filter winning cards that can't be beaten by visible player face-up cards
            let filteredWinners = winningCards.filter(cardObj => {
                const playerStronger = playerFaceUp.some(c =>
                    getCardSuit(c) === leadSuit && getCardValue(c) > getCardValue(cardObj.card)
                );
                return !playerStronger;
            });
            if (filteredWinners.length)
                return filteredWinners.reduce((lowest, card) =>
                    getCardValue(card.card) < getCardValue(lowest.card) ? card : lowest
                );
            // Otherwise minimize loss by playing lowest card of leadSuit
            return leadSuitCards.reduce((lowest, card) =>
                getCardValue(card.card) < getCardValue(lowest.card) ? card : lowest
            );
        } else {
            // Cannot beat, so lose with lowest card of leadSuit
            return leadSuitCards.reduce((lowest, card) =>
                getCardValue(card.card) < getCardValue(lowest.card) ? card : lowest
            );
        }
    } else if (trumpCards.length > 0 && getCardSuit(humanCard) !== gameState.trumpSuit) {
        // Must trump, only trump if it might win against player's trump face-up
        const lowestTrump = trumpCards.reduce((lowest, card) => 
            getCardValue(card.card) < getCardValue(lowest.card) ? card : lowest
        );
        const playerTrumpCard = playerFaceUp.find(c => getCardSuit(c) === gameState.trumpSuit);
        if (!playerTrumpCard || getCardValue(lowestTrump.card) > getCardValue(playerTrumpCard)) {
            return lowestTrump;
        }
        // Otherwise dump lowest card
        return validCards.reduce((lowest, card) =>
            getCardValue(card.card) < getCardValue(lowest.card) ? card : lowest
        );
    } else {
        // Can't follow suit or trump, throw lowest card
        return validCards.reduce((lowest, card) =>
            getCardValue(card.card) < getCardValue(lowest.card) ? card : lowest
        );
    }
}

// HARD AI - Tracks all played cards, knows remaining cards, plays optimally
function getHardAIPlay(validCards) {
    const playerFaceUp = gameState.player.faceUp.filter(c => c);
    const trumpSuit = gameState.trumpSuit;
    
    // Calculate trick targets
    const computerTarget = gameState.lastTrumpSelector === 'computer' ? 8 : 7;
    const tricksNeeded = computerTarget - gameState.computer.tricksWon;
    const tricksRemaining = 15 - gameState.trickCount;
    
    // Computer is leading the trick
    if (!gameState.trick.leadSuit) {
        // Find cards that are now the highest remaining (master cards)
        const masterCards = validCards.filter(cardObj => isHighestRemaining(cardObj.card));
        
        // If we have master cards, play them to secure tricks
        if (masterCards.length > 0 && tricksNeeded > 0) {
            // Prefer non-trump masters first to save trumps
            const nonTrumpMasters = masterCards.filter(c => getCardSuit(c.card) !== trumpSuit);
            if (nonTrumpMasters.length > 0) {
                return nonTrumpMasters[0];
            }
            return masterCards[0];
        }
        
        // If we need tricks and have high trumps, consider leading trump
        if (tricksNeeded > tricksRemaining / 2) {
            const trumpCards = validCards.filter(c => getCardSuit(c.card) === trumpSuit);
            const highTrumps = trumpCards.filter(c => isHighestRemaining(c.card));
            if (highTrumps.length > 0) {
                return highTrumps.reduce((highest, card) =>
                    getCardValue(card.card) > getCardValue(highest.card) ? card : highest
                );
            }
        }
        
        // Otherwise, lead low in a suit where we might force player to trump
        const nonTrumpCards = validCards.filter(c => getCardSuit(c.card) !== trumpSuit);
        if (nonTrumpCards.length > 0) {
            // Find suits where player might be void (based on what's been played)
            return nonTrumpCards.reduce((lowest, card) =>
                getCardValue(card.card) < getCardValue(lowest.card) ? card : lowest
            );
        }
        
        return validCards.reduce((lowest, card) =>
            getCardValue(card.card) < getCardValue(lowest.card) ? card : lowest
        );
    }

    // Computer is following the trick
    const leadSuit = gameState.trick.leadSuit;
    const humanCard = gameState.trick.cards[0].card;
    const humanCardValue = getCardValue(humanCard);
    const humanCardSuit = getCardSuit(humanCard);

    const leadSuitCards = validCards.filter(card => getCardSuit(card.card) === leadSuit);
    const trumpCards = validCards.filter(card => getCardSuit(card.card) === trumpSuit);

    if (leadSuitCards.length > 0) {
        // Check what cards remain in this suit
        const remainingInSuit = getRemainingCardsInSuit(leadSuit);
        
        // Can computer win the trick?
        const winningCards = leadSuitCards.filter(cardObj =>
            getCardValue(cardObj.card) > humanCardValue
        );
        
        if (winningCards.length) {
            // Check if our winning card will be the highest remaining
            const safeWinners = winningCards.filter(cardObj => {
                const cardValue = getCardValue(cardObj.card);
                // Check if any remaining unplayed card can beat this
                return !remainingInSuit.some(c => 
                    getCardValue(c) > cardValue && 
                    c !== cardObj.card &&
                    !gameState.playedCards.includes(c)
                );
            });
            
            if (safeWinners.length > 0) {
                // Play the lowest safe winner
                return safeWinners.reduce((lowest, card) =>
                    getCardValue(card.card) < getCardValue(lowest.card) ? card : lowest
                );
            }
            
            // If we need tricks badly, take the risk
            if (tricksNeeded > tricksRemaining - 2) {
                return winningCards.reduce((lowest, card) =>
                    getCardValue(card.card) < getCardValue(lowest.card) ? card : lowest
                );
            }
            
            // Otherwise play lowest to minimize loss
            return leadSuitCards.reduce((lowest, card) =>
                getCardValue(card.card) < getCardValue(lowest.card) ? card : lowest
            );
        } else {
            // Cannot beat, play lowest
            return leadSuitCards.reduce((lowest, card) =>
                getCardValue(card.card) < getCardValue(lowest.card) ? card : lowest
            );
        }
    } else if (trumpCards.length > 0 && humanCardSuit !== trumpSuit) {
        // We can trump! In Hard mode, we should almost always trump to win tricks
        
        // Always trump if we need tricks
        if (tricksNeeded > 0) {
            // Find our highest trump that's also the highest remaining (guaranteed win)
            const masterTrumps = trumpCards.filter(c => isHighestRemaining(c.card));
            
            if (masterTrumps.length > 0) {
                // Use the lowest master trump to win efficiently
                return masterTrumps.reduce((lowest, card) =>
                    getCardValue(card.card) < getCardValue(lowest.card) ? card : lowest
                );
            }
            
            // No master trump, but still trump with lowest to try to win
            // Check if player has higher trumps visible
            const playerTrumps = gameState.player.faceUp.filter(c => c && getCardSuit(c) === trumpSuit);
            const ourLowestTrump = trumpCards.reduce((lowest, card) =>
                getCardValue(card.card) < getCardValue(lowest.card) ? card : lowest
            );
            
            // If player has no visible trumps, or our trump might win, use it
            if (playerTrumps.length === 0) {
                return ourLowestTrump;
            }
            
            // Even if player has trumps, if we need tricks badly, trump anyway
            if (tricksNeeded >= tricksRemaining / 2) {
                return ourLowestTrump;
            }
        }
        
        // If we don't need tricks, dump lowest non-trump
        const nonTrumps = validCards.filter(c => getCardSuit(c.card) !== trumpSuit);
        if (nonTrumps.length > 0) {
            return nonTrumps.reduce((lowest, card) =>
                getCardValue(card.card) < getCardValue(lowest.card) ? card : lowest
            );
        }
        
        // Only trumps left, play lowest
        return trumpCards.reduce((lowest, card) =>
            getCardValue(card.card) < getCardValue(lowest.card) ? card : lowest
        );
    } else {
        // Can't follow suit or trump, throw lowest card
        return validCards.reduce((lowest, card) =>
            getCardValue(card.card) < getCardValue(lowest.card) ? card : lowest
        );
    }
}


function selectLeadingCard(validCards) {
    // Prefer high trumps or aces
    const trumps = validCards.filter(card => getCardSuit(card.card) === gameState.trumpSuit);
    const aces = validCards.filter(card => getCardRank(card.card) === 'A');
    
    if (trumps.length > 0) {
        return trumps.reduce((highest, card) => 
            getCardValue(card.card) > getCardValue(highest.card) ? card : highest
        );
    }
    
    if (aces.length > 0) {
        return aces[0];
    }
    
    // Play lowest non-trump
    return validCards.reduce((lowest, card) => 
        getCardValue(card.card) < getCardValue(lowest.card) ? card : lowest
    );
}

function selectFollowingCard(validCards, leadSuit) {
    const humanCard = gameState.trick.cards[0].card;
    const humanCardValue = getCardValue(humanCard);
    const leadSuitCards = validCards.filter(card => getCardSuit(card.card) === leadSuit);
    const trumpCards = validCards.filter(card => getCardSuit(card.card) === gameState.trumpSuit);
    
    if (leadSuitCards.length > 0) {
        // Must follow suit
        const winningCards = leadSuitCards.filter(card => getCardValue(card.card) > humanCardValue);
        if (winningCards.length > 0) {
            // Play lowest winning card
            return winningCards.reduce((lowest, card) => 
                getCardValue(card.card) < getCardValue(lowest.card) ? card : lowest
            );
        } else {
            // Play lowest losing card
            return leadSuitCards.reduce((lowest, card) => 
                getCardValue(card.card) < getCardValue(lowest.card) ? card : lowest
            );
        }
    } else if (trumpCards.length > 0 && getCardSuit(humanCard) !== gameState.trumpSuit) {
        // Can trump
        return trumpCards.reduce((lowest, card) => 
            getCardValue(card.card) < getCardValue(lowest.card) ? card : lowest
        );
    } else {
        // Play lowest card
        return validCards.reduce((lowest, card) => 
            getCardValue(card.card) < getCardValue(lowest.card) ? card : lowest
        );
    }
}

function computerPlay() {
    // Enhanced safety checks
    if (gameState.resolvingTrick || 
        gameState.currentPlayer !== 'computer' || 
        gameState.gamePhase !== 'playing' ||
        gameState.trick.cards.length >= 2) {  // ← NEW: Prevent playing if trick is already full
        return;
    }
    
    // Set a flag to prevent double execution
    if (gameState.computerThinking) {
        return;
    }
    gameState.computerThinking = true;
    
    showThinking(true);
    
    runBeat('computer-think', {}, () => {
        // Double-check conditions again after the thinking delay
        if (gameState.resolvingTrick || 
            gameState.currentPlayer !== 'computer' || 
            gameState.gamePhase !== 'playing' ||
            gameState.trick.cards.length >= 2) {
            gameState.computerThinking = false;
            showThinking(false);
            return;
        }
        
        const play = getComputerPlay();
        if (play) {
            // Play the selected card
            const currentPlayerData = gameState.computer;
            let card = play.card;
            
            // Log the computer play
            const cardDisplay = `${getCardRank(card)}${getSuitSymbol(getCardSuit(card))}`;
            addToLog(`Computer played ${cardDisplay}`, 'computer-action');
            
            if (play.source === 'hand') {
                const index = currentPlayerData.hand.findIndex(c => c === card);
                if (index !== -1) {
                    currentPlayerData.hand[index] = null;
                }
            } else {
                const index = currentPlayerData.faceUp.findIndex(c => c === card);
                if (index !== -1) {
                    currentPlayerData.faceUp[index] = null;
                    revealFaceDownCard(currentPlayerData, index);
                }
            }
            
            // Add card to trick
            gameState.trick.cards.push({
                card: card,
                player: gameState.currentPlayer
            });
            
            // Set lead suit if this is the first card
            if (gameState.trick.cards.length === 1) {
                gameState.trick.leadSuit = getCardSuit(card);
            }
            
            gameState.computerThinking = false;
            showThinking(false);
            updateDisplay();
            
            // Check if trick is complete
            if (gameState.trick.cards.length === 2) {
                gameState.resolvingTrick = true;
                runBeat('trick-complete', {}, resolveTrick);
            } else {
                // Switch to player
                gameState.currentPlayer = 'player';
                showStatus("Your turn to play");
            }
        } else {
            gameState.computerThinking = false;
            showThinking(false);
        }
    });
}


// Trick resolution
function resolveTrick() {
    if (gameState.trick.cards.length !== 2) return;
    
    const card1 = gameState.trick.cards[0];
    const card2 = gameState.trick.cards[1];
    
    // Track played cards for Hard mode
    gameState.playedCards.push(card1.card);
    gameState.playedCards.push(card2.card);
    
    let winner = determineTrickWinner(card1, card2);
    
    // Award trick to winner
    const winnerData = gameState[winner];
    winnerData.wonTricks.push([...gameState.trick.cards]);
    winnerData.tricksWon++;
    
    // Log trick winner
    const winningCard = winner === card1.player 
        ? `${getCardRank(card1.card)}${getSuitSymbol(getCardSuit(card1.card))}`
        : `${getCardRank(card2.card)}${getSuitSymbol(getCardSuit(card2.card))}`;
    
    if (winner === 'player') {
        addToLog(`You won the trick with ${winningCard}!`, 'trick-won');
    } else {
        addToLog(`Computer won the trick with ${winningCard}.`, 'trick-lost');
    }
    
    // Update display with winner highlight
    highlightTrickWinner(winner);
    
    // Clear trick
    gameState.trick = { cards: [], leadSuit: null };
    gameState.trickCount++;
    gameState.currentPlayer = winner;
    gameState.resolvingTrick = false;
    
    runBeat('trick-cleared', { winner }, () => {
        updateDisplay();
        
        // Check if round is complete
        if (isRoundComplete()) {
            endRound();
        } else {
            if (gameState.currentPlayer === 'computer') {
                showStatus("Computer leads next trick");
                runBeat('computer-lead', {}, computerPlay);
            } else {
                showStatus("You lead the next trick");
            }
        }
    });
}

function determineTrickWinner(card1, card2) {
    const card1Suit = getCardSuit(card1.card);
    const card2Suit = getCardSuit(card2.card);
    const card1Value = getCardValue(card1.card);
    const card2Value = getCardValue(card2.card);
    
    // Trump logic
    if (card1Suit === gameState.trumpSuit && card2Suit !== gameState.trumpSuit) {
        return card1.player;
    } else if (card2Suit === gameState.trumpSuit && card1Suit !== gameState.trumpSuit) {
        return card2.player;
    } else if (card1Suit === gameState.trumpSuit && card2Suit === gameState.trumpSuit) {
        return card1Value > card2Value ? card1.player : card2.player;
    } else if (card1Suit === gameState.trick.leadSuit && card2Suit === gameState.trick.leadSuit) {
        return card1Value > card2Value ? card1.player : card2.player;
    } else if (card1Suit === gameState.trick.leadSuit) {
        return card1.player;
    } else {
        return card2.player;
    }
}

// Round and game management
function isRoundComplete() {
    // Check if all cards have been played
    const playerCards = gameState.player.hand.filter(c => c).length + 
                       gameState.player.faceUp.filter(c => c).length;
    const computerCards = gameState.computer.hand.filter(c => c).length + 
                         gameState.computer.faceUp.filter(c => c).length;
    
    return playerCards === 0 && computerCards === 0;
}

function endRound() {
    const scores = calculateRoundScore();
    
    const message = `Round ${gameState.roundNumber} Complete! Player: +${scores.playerRoundScore} points, Computer: +${scores.computerRoundScore} points`;
    showStatus(message);
    addToLog(message);
    updateDisplay(); // refresh the scoreboard with the round's points (view only, no state change)
    
    // Check for game end
    if (checkGameEnd()) {
        return;
    }
    
    // Prepare for next round
    runBeat('round-end', {}, () => {
        gameState.roundNumber++;
        GameView.setNewRoundButton(true);
        showStatus("Click 'New Round' to continue");
    });
}

function calculateRoundScore() {
    const playerTricks = gameState.player.tricksWon;
    const computerTricks = gameState.computer.tricksWon;
    
    let playerRoundScore = 0;
    let computerRoundScore = 0;
    
    // Determine who selected trump and calculate scores
    if (gameState.lastTrumpSelector === 'player') {
        // Player selected trump (target: 8), Computer (target: 7)
        playerRoundScore = Math.max(0, playerTricks - 8);      // Points for exceeding target
        computerRoundScore = Math.max(0, computerTricks - 7);  // Points for exceeding target
    } else {
        // Computer selected trump (target: 8), Player (target: 7)
        computerRoundScore = Math.max(0, computerTricks - 8);  // Points for exceeding target
        playerRoundScore = Math.max(0, playerTricks - 7);      // Points for exceeding target
    }
    
    // Add to cumulative scores
    gameState.player.score += playerRoundScore;
    gameState.computer.score += computerRoundScore;
    
    return { 
        playerRoundScore: playerRoundScore, 
        computerRoundScore: computerRoundScore,
        playerTotal: gameState.player.score,
        computerTotal: gameState.computer.score
    };
}

function checkGameEnd() {
    if (gameState.player.score >= 1 || gameState.computer.score >= 1) {
        const winner = gameState.player.score >= 1 ? 'Player' : 'Computer';
        gameState.gameOver = true;
        addToLog(`Game Over! ${winner} wins with ${winner === 'Player' ? gameState.player.score : gameState.computer.score} points!`, 'trick-won');
        showGameOver(winner);
        return true;
    }
    return false;
}

function startNewRound() {
    // Reset trick data
    gameState.player.wonTricks = [];
    gameState.computer.wonTricks = [];
    gameState.player.tricksWon = 0;
    gameState.computer.tricksWon = 0;
    gameState.trick = { cards: [], leadSuit: null };
    gameState.trickCount = 0;
    gameState.trumpSuit = null;
    gameState.playedCards = []; // Reset played cards tracking
    
    // Deal initial hand cards only
    dealInitialCards();
    
    // First round - do coin toss
    if (gameState.isFirstRound) {
        gameState.gamePhase = 'coin-toss';
        showCoinToss();
        return;
    }
    
    // Not first round - alternate trump selector
    continueAfterCoinToss();
}

function continueAfterCoinToss() {
    // Log round start
    if (gameState.roundNumber === 1) {
        addToLog("Game started! Select your trump suit.", 'trump-selection');
    } else {
        addToLog(`Round ${gameState.roundNumber} started!`);
    }
    
    // For first round, use coin toss winner. After that, alternate
    if (gameState.isFirstRound) {
        gameState.lastTrumpSelector = gameState.coinTossWinner;
        gameState.isFirstRound = false;
    } else {
        gameState.lastTrumpSelector = gameState.lastTrumpSelector === 'player' ? 'computer' : 'player';
    }
    
    gameState.currentPlayer = gameState.lastTrumpSelector;
    gameState.gamePhase = 'trump-selection';
    
    if (gameState.lastTrumpSelector === 'player') {
        showTrumpSelection();
    } else {
        showStatus("Computer is selecting trump...");
        runBeat('computer-trump', {}, selectComputerTrump);
    }
    
    GameView.setNewRoundButton(false);
    updateDisplay();
}

// Coin Toss
function showCoinToss() {
    GameView.showCoinToss(performCoinToss);
}

function performCoinToss(playerChoice) {
    // Random result
    const result = Math.random() < 0.5 ? 'heads' : 'tails';
    const playerWins = playerChoice === result;

    GameView.coinTossBegin();

    // Once the coin has landed, reveal the result
    runBeat('coin-flip', { result, playerWins }, () => {
        GameView.coinTossReveal(result, playerWins);

        if (playerWins) {
            gameState.coinTossWinner = 'player';
            addToLog(`Coin toss: ${result.toUpperCase()}! You won and will choose trump first.`);
        } else {
            gameState.coinTossWinner = 'computer';
            addToLog(`Coin toss: ${result.toUpperCase()}! Computer won and will choose trump first.`);
        }

        // Close modal and continue game once the result has been shown
        runBeat('coin-result', { result, playerWins }, () => {
            GameView.hideCoinToss();
            continueAfterCoinToss();
        });
    });
}

// Trump selection
function showTrumpSelection() {
    GameView.showTrumpSelection(suit => setTrump(suit));
}

// Function to update select trump button visibility
function updateSelectTrumpButtonVisibility() {
    // Show button only if:
    // 1. Trump is not selected (null)
    // 2. It's player's turn to select trump
    // 3. Game is in trump-selection phase
    // 4. Trump modal is not visible (checked by the view)
    GameView.setSelectTrumpButton(
        gameState.trumpSuit === null &&
        gameState.lastTrumpSelector === 'player' &&
        gameState.gamePhase === 'trump-selection'
    );
}

function setTrump(suit) {
    gameState.trumpSuit = suit;
    gameState.gamePhase = 'dealing-remaining';
    
    // Hide select trump button since trump is now selected
    GameView.hideSelectTrumpButton();
    
    const suitSymbol = getSuitSymbol(suit);
    
    if (gameState.lastTrumpSelector === 'computer') {
        addToLog(`Computer selected ${suit} ${suitSymbol} as trump. Computer goes first!`, 'trump-selection');
        showStatus("Computer selected trump. Dealing remaining cards...");
    } else {
        addToLog(`You selected ${suit} ${suitSymbol} as trump. You go first!`, 'trump-selection');
        showStatus("You selected trump. Dealing remaining cards...");
    }
    
    // Deal the remaining face-down and face-up cards
    runBeat('deal-remaining', {}, () => {
        dealRemainingCards();
        gameState.gamePhase = 'playing';
        updateDisplay();
        
        if (gameState.lastTrumpSelector === 'computer') {
            runBeat('computer-lead', {}, computerPlay);
        } else {
            showStatus("Your turn to play");
        }
    });
}

// Game actions (called from ui.js)
function startGame() {
    gameState.gameStarted = true;
    gameState.gamePhase = 'setup';
    startNewRound();
    GameView.setStartButton(false);
    showStatus("Game started!");
}

function restartGame() {
    // Cancel everything the previous game still has pending, and clear the flags
    // that those cancelled continuations would have cleared themselves.
    flowSession++;
    gameState.computerThinking = false;
    gameState.resolvingTrick = false;

    // Reset all game state (but keep difficulty)
    gameState.player.score = 0;
    gameState.computer.score = 0;
    gameState.roundNumber = 1;
    gameState.gameOver = false;
    gameState.gameStarted = false;
    gameState.lastTrumpSelector = null;
    gameState.gamePhase = 'setup';
    gameState.trumpSuit = null;
    gameState.playedCards = [];
    gameState.isFirstRound = true;  // Reset for coin toss
    gameState.coinTossWinner = null;

    GameView.resetForRestart();

    // Clear and reset log
    clearLog();
    addToLog("Game reset - Click 'Start Game' to begin");

    showStatus("Click 'Start Game' to begin");
}

// Select Trump button (for when modal is accidentally closed)
function reopenTrumpSelection() {
    if (gameState.trumpSuit === null &&
        gameState.lastTrumpSelector === 'player' &&
        gameState.gamePhase === 'trump-selection') {
        showTrumpSelection();
    }
}

function setDifficulty(difficulty) {
    gameState.difficulty = difficulty;
    addToLog(`Difficulty changed to ${difficulty.toUpperCase()}. Will apply on new game/round.`);
}

function ready() {
    addToLog("Game ready - Click 'Start Game' to begin");
    showStatus("Click 'Start Game' to begin");
}

// Read-only helpers for the view. Neither changes any rule or state.
// Would this card be legal for `side` right now? Reuses isValidPlay (which judges the current player).
function isValidPlayFor(side, card) {
    const saved = gameState.currentPlayer;
    gameState.currentPlayer = side;
    try {
        return isValidPlay(card, gameState.trick.leadSuit);
    } finally {
        gameState.currentPlayer = saved;
    }
}

// Trick target for the HUD (trump selector 8, opponent 7); null until trump is chosen.
function getTrickTarget(side) {
    if (!gameState.trumpSuit || !gameState.lastTrumpSelector) return null;
    return gameState.lastTrumpSelector === side ? 8 : 7;
}

// Public engine API: the only thing presentation.js and ui.js may use.
const GameEngine = {
    state: gameState,
    // queries
    isValidPlay,
    isValidPlayFor,
    getTrickTarget,
    getCardSuit,
    getCardRank,
    getCardValue,
    getSuitSymbol,
    // commands
    startGame,
    startNewRound,
    restartGame,
    playCard,
    setDifficulty,
    reopenTrumpSelection,
    updateSelectTrumpButtonVisibility,
    ready
};
