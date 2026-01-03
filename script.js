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

// Game Log Functions
function addToLog(message, type = '') {
    const logContent = document.getElementById('game-log');
    if (!logContent) return;
    
    const logMessage = document.createElement('div');
    logMessage.className = `log-message ${type}`;
    logMessage.textContent = message;
    
    logContent.appendChild(logMessage);
    
    // Auto-scroll to bottom
    logContent.scrollTop = logContent.scrollHeight;
    
    // Keep only last 50 messages
    const messages = logContent.querySelectorAll('.log-message');
    if (messages.length > 50) {
        logContent.removeChild(messages[0]);
    }
}

function clearLog() {
    const logContent = document.getElementById('game-log');
    if (logContent) {
        logContent.innerHTML = '<div class="log-message">Log cleared...</div>';
    }
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
        setTimeout(resolveTrick, 1500);
    } else {
        // Switch to computer
        gameState.currentPlayer = 'computer';
        showStatus("Computer is playing...");
        setTimeout(computerPlay, 1000);
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
    
    setTimeout(() => {
        // Double-check conditions again after timeout
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
                setTimeout(resolveTrick, 1500);
            } else {
                // Switch to player
                gameState.currentPlayer = 'player';
                showStatus("Your turn to play");
            }
        } else {
            gameState.computerThinking = false;
            showThinking(false);
        }
    }, 1000);
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
    
    setTimeout(() => {
        updateDisplay();
        
        // Check if round is complete
        if (isRoundComplete()) {
            endRound();
        } else {
            if (gameState.currentPlayer === 'computer') {
                showStatus("Computer leads next trick");
                setTimeout(computerPlay, 1000);
            } else {
                showStatus("You lead the next trick");
            }
        }
    }, 1000);
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
    
    // Check for game end
    if (checkGameEnd()) {
        return;
    }
    
    // Prepare for next round
    setTimeout(() => {
        gameState.roundNumber++;
        document.getElementById('new-round').style.display = 'block';
        showStatus("Click 'New Round' to continue");
    }, 3000);
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
        setTimeout(selectComputerTrump, 1500);
    }
    
    document.getElementById('new-round').style.display = 'none';
    updateDisplay();
}

// Coin Toss
function showCoinToss() {
    const modal = document.getElementById('coin-toss-modal');
    const coin = document.getElementById('coin');
    const coinChoice = document.getElementById('coin-choice');
    const coinResult = document.getElementById('coin-result');
    const coinBtns = document.querySelectorAll('.coin-btn');
    
    // Reset coin state
    coin.className = 'coin';
    coinChoice.style.display = 'block';
    coinResult.style.display = 'none';
    coinBtns.forEach(btn => btn.disabled = false);
    
    modal.style.display = 'flex';
    
    coinBtns.forEach(btn => {
        btn.onclick = () => performCoinToss(btn.dataset.choice);
    });
}

function performCoinToss(playerChoice) {
    const coin = document.getElementById('coin');
    const coinChoice = document.getElementById('coin-choice');
    const coinResult = document.getElementById('coin-result');
    const coinBtns = document.querySelectorAll('.coin-btn');
    
    // Disable buttons
    coinBtns.forEach(btn => btn.disabled = true);
    coinChoice.style.display = 'none';
    
    // Random result
    const result = Math.random() < 0.5 ? 'heads' : 'tails';
    const playerWins = playerChoice === result;
    
    // Set animation based on result
    coin.className = 'coin flipping';
    
    // After animation, show result
    setTimeout(() => {
        coin.className = `coin result-${result}`;
        coinResult.style.display = 'block';
        
        if (playerWins) {
            coinResult.className = 'coin-result win';
            coinResult.innerHTML = `<div>🎉 It's ${result.toUpperCase()}!</div><div>You won! You choose trump first.</div>`;
            gameState.coinTossWinner = 'player';
            addToLog(`Coin toss: ${result.toUpperCase()}! You won and will choose trump first.`);
        } else {
            coinResult.className = 'coin-result lose';
            coinResult.innerHTML = `<div>It's ${result.toUpperCase()}!</div><div>Computer won! Computer chooses trump first.</div>`;
            gameState.coinTossWinner = 'computer';
            addToLog(`Coin toss: ${result.toUpperCase()}! Computer won and will choose trump first.`);
        }
        
        // Close modal and continue game after delay
        setTimeout(() => {
            document.getElementById('coin-toss-modal').style.display = 'none';
            continueAfterCoinToss();
        }, 2500);
    }, 3000);
}

// Trump selection
function showTrumpSelection() {
    const modal = document.getElementById('trump-selection-modal');
    modal.style.display = 'flex';
    
    // Hide select trump button when modal opens
    const selectTrumpBtn = document.getElementById('select-trump-btn');
    if (selectTrumpBtn) {
        selectTrumpBtn.style.display = 'none';
    }
    
    const trumpButtons = document.querySelectorAll('.trump-btn');
    trumpButtons.forEach(btn => {
        btn.onclick = () => {
            const suit = btn.dataset.suit;
            setTrump(suit);
            modal.style.display = 'none';
        };
    });
}

// Function to update select trump button visibility
function updateSelectTrumpButtonVisibility() {
    const selectTrumpBtn = document.getElementById('select-trump-btn');
    if (!selectTrumpBtn) return;
    
    // Show button only if:
    // 1. Trump is not selected (null)
    // 2. It's player's turn to select trump
    // 3. Game is in trump-selection phase
    // 4. Trump modal is not visible
    const trumpModal = document.getElementById('trump-selection-modal');
    const isModalHidden = !trumpModal || trumpModal.style.display === 'none' || trumpModal.style.display === '';
    
    if (gameState.trumpSuit === null && 
        gameState.lastTrumpSelector === 'player' && 
        gameState.gamePhase === 'trump-selection' &&
        isModalHidden) {
        selectTrumpBtn.style.display = 'block';
    } else {
        selectTrumpBtn.style.display = 'none';
    }
}

function setTrump(suit) {
    gameState.trumpSuit = suit;
    gameState.gamePhase = 'dealing-remaining';
    
    // Hide select trump button since trump is now selected
    const selectTrumpBtn = document.getElementById('select-trump-btn');
    if (selectTrumpBtn) {
        selectTrumpBtn.style.display = 'none';
    }
    
    const suitSymbol = getSuitSymbol(suit);
    
    if (gameState.lastTrumpSelector === 'computer') {
        addToLog(`Computer selected ${suit} ${suitSymbol} as trump. Computer goes first!`, 'trump-selection');
        showStatus("Computer selected trump. Dealing remaining cards...");
    } else {
        addToLog(`You selected ${suit} ${suitSymbol} as trump. You go first!`, 'trump-selection');
        showStatus("You selected trump. Dealing remaining cards...");
    }
    
    // Deal the remaining face-down and face-up cards
    setTimeout(() => {
        dealRemainingCards();
        gameState.gamePhase = 'playing';
        updateDisplay();
        
        if (gameState.lastTrumpSelector === 'computer') {
            setTimeout(computerPlay, 1000);
        } else {
            showStatus("Your turn to play");
        }
    }, 2000);
}

// Display functions
function createCardElement(card, isBack = false) {
    const cardElement = document.createElement('div');
    cardElement.className = 'card card-deal-animation';
    
    if (isBack) {
        cardElement.classList.add('card-back');
        return cardElement;
    }
    
    const suit = getCardSuit(card);
    const rank = getCardRank(card);
    
    cardElement.classList.add(suit);
    cardElement.innerHTML = `
        <div class="card-rank">${rank}</div>
        <div class="card-suit">${getSuitSymbol(suit)}</div>
        <div class="card-rank bottom-rank">${rank}</div>
    `;
    
    return cardElement;
}

function updateDisplay() {
    // Update player hand
    const playerHandContainer = document.querySelector('#player-hand .cards-container');
    if (playerHandContainer) {
        playerHandContainer.innerHTML = '';
        gameState.player.hand.forEach((card, index) => {
            if (card) {
                const cardElement = createCardElement(card);
                
                // Only make clickable during playing phase
                if (gameState.gamePhase === 'playing') {
                    cardElement.onclick = () => playCard(index, 'hand');
                    
                    // Add visual feedback for valid plays
                    if (gameState.currentPlayer === 'player' && !gameState.resolvingTrick) {
                        if (isValidPlay(card, gameState.trick.leadSuit)) {
                            cardElement.classList.add('playable');
                        } else {
                            cardElement.classList.add('invalid');
                        }
                    }
                }
                
                playerHandContainer.appendChild(cardElement);
            }
        });
    }
    
    // Update player face-up cards (only show if dealt)
    const playerFaceUpContainer = document.querySelector('#player-faceup .cards-container');
    if (playerFaceUpContainer) {
        playerFaceUpContainer.innerHTML = '';
        gameState.player.faceUp.forEach((card, index) => {
            if (card) {
                const cardElement = createCardElement(card);
                
                // Only make clickable during playing phase
                if (gameState.gamePhase === 'playing') {
                    cardElement.onclick = () => playCard(index, 'faceUp');
                    
                    if (gameState.player.faceDown[index]) {
                        cardElement.classList.add('has-hidden-card');
                    }
                    
                    // Add visual feedback for valid plays
                    if (gameState.currentPlayer === 'player' && !gameState.resolvingTrick) {
                        if (isValidPlay(card, gameState.trick.leadSuit)) {
                            cardElement.classList.add('playable');
                        } else {
                            cardElement.classList.add('invalid');
                        }
                    }
                }
                
                playerFaceUpContainer.appendChild(cardElement);
            }
        });
    }
    
    // Update computer hand (show card backs)
    const computerHandContainer = document.querySelector('#computer-hand .cards-container');
    if (computerHandContainer) {
        computerHandContainer.innerHTML = '';
        gameState.computer.hand.forEach(card => {
            if (card) {
                computerHandContainer.appendChild(createCardElement(card, true));
            }
        });
    }
    
    // Update computer face-up cards (only show if dealt)
    const computerFaceUpContainer = document.querySelector('#computer-faceup .cards-container');
    if (computerFaceUpContainer) {
        computerFaceUpContainer.innerHTML = '';
        gameState.computer.faceUp.forEach((card, index) => {
            if (card) {
                const cardElement = createCardElement(card);
                if (gameState.computer.faceDown[index]) {
                    cardElement.classList.add('has-hidden-card');
                }
                computerFaceUpContainer.appendChild(cardElement);
            }
        });
    }
    
    // Update current trick
    const trickContainer = document.querySelector('.trick-cards');
    if (trickContainer) {
        trickContainer.innerHTML = '';
        gameState.trick.cards.forEach(play => {
            const cardElement = createCardElement(play.card);
            cardElement.classList.add('played');
            trickContainer.appendChild(cardElement);
        });
    }
    
    // Update trump display
    if (gameState.trumpSuit) {
        const trumpDisplay = document.getElementById('trump-display');
        if (trumpDisplay) {
            trumpDisplay.innerHTML = `Trump: ${getSuitSymbol(gameState.trumpSuit)} ${gameState.trumpSuit}`;
            trumpDisplay.className = `trump-indicator trump-${gameState.trumpSuit}`;
        }
    }
    
    // Update scores
    const scoreDisplay = document.getElementById('score-display');
    if (scoreDisplay) {
        scoreDisplay.textContent = `Player: ${gameState.player.score} | Computer: ${gameState.computer.score}`;
    }
    
    // Update round info
    const roundInfo = document.getElementById('round-info');
    if (roundInfo) {
        roundInfo.textContent = `Round: ${gameState.roundNumber}`;
    }
    
    // Update trick counts
    const playerTrickCount = document.querySelector('#player-tricks .trick-count');
    const computerTrickCount = document.querySelector('#computer-tricks .trick-count');
    if (playerTrickCount) playerTrickCount.textContent = gameState.player.tricksWon;
    if (computerTrickCount) computerTrickCount.textContent = gameState.computer.tricksWon;
    
    // Update trick piles display
    updateTrickPiles();
}

function updateTrickPiles() {
    // Player tricks
    const playerTricksContainer = document.querySelector('#player-tricks .tricks-container');
    if (playerTricksContainer) {
        playerTricksContainer.innerHTML = '';
        for (let i = 0; i < gameState.player.tricksWon; i++) {
            const trickPile = document.createElement('div');
            trickPile.className = 'trick-pile';
            playerTricksContainer.appendChild(trickPile);
        }
    }
    
    // Computer tricks
    const computerTricksContainer = document.querySelector('#computer-tricks .tricks-container');
    if (computerTricksContainer) {
        computerTricksContainer.innerHTML = '';
        for (let i = 0; i < gameState.computer.tricksWon; i++) {
            const trickPile = document.createElement('div');
            trickPile.className = 'trick-pile';
            computerTricksContainer.appendChild(trickPile);
        }
    }
}

// UI Helper functions
function showStatus(message) {
    const statusElement = document.getElementById('game-status');
    if (statusElement) {
        statusElement.innerHTML = `<span>${message}</span>`;
    }
}

function showThinking(show) {
    const indicator = document.getElementById('thinking-indicator');
    if (indicator) {
        indicator.style.display = show ? 'block' : 'none';
    }
}

function highlightTrickWinner(winner) {
    const winnerArea = winner === 'player' ? '.player-area' : '.computer-area';
    const area = document.querySelector(winnerArea);
    if (area) {
        area.classList.add('highlight-winner');
        setTimeout(() => {
            area.classList.remove('highlight-winner');
        }, 2000);
    }
}

function showGameOver(winner) {
    const modal = document.getElementById('game-over-modal');
    const winnerText = document.getElementById('winner-announcement');
    const finalScores = document.getElementById('final-scores');
    
    if (modal && winnerText && finalScores) {
        if (winner === 'Player') {
            winnerText.textContent = `🎉 Congratulations! You Win! 🎉`;
            // Trigger confetti
            createConfetti();
        } else {
            winnerText.textContent = `Better Luck Next Time!`;
        }
        finalScores.innerHTML = `
            <p>Final Score</p>
            <p>Player: ${gameState.player.score} | Computer: ${gameState.computer.score}</p>
        `;
        modal.style.display = 'flex';
    }
}

// Confetti animation function
function createConfetti() {
    const colors = ['#ffdd44', '#ff4444', '#4CAF50', '#2196F3', '#ff6b6b', '#ffd700'];
    const confettiCount = 100;
    
    for (let i = 0; i < confettiCount; i++) {
        setTimeout(() => {
            const confetti = document.createElement('div');
            confetti.className = 'confetti';
            confetti.style.left = Math.random() * 100 + '%';
            confetti.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
            confetti.style.animationDelay = Math.random() * 3 + 's';
            confetti.style.animationDuration = (Math.random() * 3 + 2) + 's';
            document.body.appendChild(confetti);
            
            // Remove confetti after animation
            setTimeout(() => {
                confetti.remove();
            }, 5000);
        }, i * 30);
    }
}

// Game initialization and event listeners
function initializeGame() {
    // Add initial log message
    addToLog("Game ready - Click 'Start Game' to begin");
    
    // Settings Modal
    const settingsBtn = document.getElementById('settings-btn');
    const settingsBtnMobile = document.getElementById('settings-btn-mobile');
    const closeSettingsBtn = document.getElementById('close-settings');
    const settingsModal = document.getElementById('settings-modal');
    
    const openSettings = () => {
        if (settingsModal) settingsModal.style.display = 'flex';
    };
    
    if (settingsBtn) settingsBtn.onclick = openSettings;
    if (settingsBtnMobile) settingsBtnMobile.onclick = openSettings;
    
    if (closeSettingsBtn && settingsModal) {
        closeSettingsBtn.onclick = () => {
            settingsModal.style.display = 'none';
        };
    }
    
    // Difficulty buttons
    const difficultyBtns = document.querySelectorAll('.difficulty-btn');
    const difficultyDesc = document.getElementById('difficulty-desc');
    const difficultyDisplay = document.getElementById('difficulty-display');
    
    const difficultyDescriptions = {
        easy: "Relaxed AI that makes random choices. Great for learning!",
        medium: "Balanced AI that analyzes visible cards.",
        hard: "Expert AI that tracks all played cards and plays optimally!"
    };
    
    difficultyBtns.forEach(btn => {
        btn.onclick = () => {
            const difficulty = btn.dataset.difficulty;
            gameState.difficulty = difficulty;
            
            // Update active state
            difficultyBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            
            // Update description
            if (difficultyDesc) {
                difficultyDesc.textContent = difficultyDescriptions[difficulty];
            }
            
            // Update display in header
            if (difficultyDisplay) {
                difficultyDisplay.innerHTML = `<span>${difficulty.charAt(0).toUpperCase() + difficulty.slice(1)}</span>`;
            }
            
            addToLog(`Difficulty changed to ${difficulty.toUpperCase()}. Will apply on new game/round.`);
        };
    });
    
    // Settings action buttons
    const settingsGameLog = document.getElementById('settings-game-log');
    const settingsRules = document.getElementById('settings-rules');
    const logModal = document.getElementById('game-log-modal');
    const rulesModal = document.getElementById('rules-modal');
    
    if (settingsGameLog && logModal && settingsModal) {
        settingsGameLog.onclick = () => {
            settingsModal.style.display = 'none';  // Hide settings first
            logModal.style.display = 'flex';
        };
    }
    
    if (settingsRules && rulesModal && settingsModal) {
        settingsRules.onclick = () => {
            settingsModal.style.display = 'none';  // Hide settings first
            rulesModal.style.display = 'flex';
        };
    }
    
    // Game Log Modal close button - reopen settings when closing
    const closeLogBtn = document.getElementById('close-log-modal');
    const clearLogBtn = document.getElementById('clear-log');
    
    if (closeLogBtn && logModal) {
        closeLogBtn.onclick = () => {
            logModal.style.display = 'none';
            // Reopen settings modal
            if (settingsModal) settingsModal.style.display = 'flex';
        };
    }
    
    if (clearLogBtn) {
        clearLogBtn.onclick = clearLog;
    }
    
    // Start game button
    const startGameBtn = document.getElementById('start-game');
    if (startGameBtn) {
        startGameBtn.onclick = () => {
            gameState.gameStarted = true;
            gameState.gamePhase = 'setup';
            startNewRound();
            startGameBtn.style.display = 'none';
            showStatus("Game started!");
        };
    }
    
    // New round button
    const newRoundBtn = document.getElementById('new-round');
    if (newRoundBtn) {
        newRoundBtn.onclick = startNewRound;
    }
    
    // Restart game button
    const restartBtn = document.getElementById('restart-game');
    if (restartBtn) {
        restartBtn.onclick = () => {
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
            
            // Hide modals
            const gameOverModal = document.getElementById('game-over-modal');
            const trumpModal = document.getElementById('trump-selection-modal');
            if (gameOverModal) gameOverModal.style.display = 'none';
            if (trumpModal) trumpModal.style.display = 'none';
            
            // Hide select trump button
            const selectTrumpBtn = document.getElementById('select-trump-btn');
            if (selectTrumpBtn) selectTrumpBtn.style.display = 'none';
            
            // Show start button
            if (startGameBtn) startGameBtn.style.display = 'block';
            if (newRoundBtn) newRoundBtn.style.display = 'none';
            
            // Clear display
            const containers = [
                '#player-hand .cards-container',
                '#player-faceup .cards-container',
                '#computer-hand .cards-container',
                '#computer-faceup .cards-container',
                '.trick-cards'
            ];
            
            containers.forEach(selector => {
                const container = document.querySelector(selector);
                if (container) container.innerHTML = '';
            });
            
            // Reset displays
            const trumpDisplay = document.getElementById('trump-display');
            const scoreDisplay = document.getElementById('score-display');
            const roundInfo = document.getElementById('round-info');
            
            if (trumpDisplay) trumpDisplay.innerHTML = 'Trump: None';
            if (scoreDisplay) scoreDisplay.textContent = 'Player: 0 | Computer: 0';
            if (roundInfo) roundInfo.textContent = 'Round: 1';
            
            // Clear and reset log
            clearLog();
            addToLog("Game reset - Click 'Start Game' to begin");
            
            showStatus("Click 'Start Game' to begin");
        };
    }
    
    // Game over modal buttons
    const playAgainBtn = document.getElementById('play-again');
    const exitGameBtn = document.getElementById('exit-game');
    
    if (playAgainBtn && restartBtn) {
        playAgainBtn.onclick = () => restartBtn.click();
    }
    
    if (exitGameBtn) {
        exitGameBtn.onclick = () => {
            if (confirm("Are you sure you want to exit the game?")) {
                window.close();
            }
        };
    }
    
    // Help/Rules modal (using rulesModal2 to avoid conflict)
    const showRulesBtn = document.getElementById('show-rules');
    const showRulesMobileBtn = document.getElementById('show-rules-mobile');
    const closeRulesBtn = document.getElementById('close-rules');
    const rulesModal2 = document.getElementById('rules-modal');
    
    if (showRulesBtn && rulesModal2) {
        showRulesBtn.onclick = () => {
            rulesModal2.style.display = 'flex';
        };
    }
    
    // Mobile rules button
    if (showRulesMobileBtn && rulesModal2) {
        showRulesMobileBtn.onclick = () => {
            rulesModal2.style.display = 'flex';
        };
    }
    
    if (closeRulesBtn && rulesModal2) {
        closeRulesBtn.onclick = () => {
            rulesModal2.style.display = 'none';
            // Reopen settings modal
            const settingsModalRef = document.getElementById('settings-modal');
            if (settingsModalRef) settingsModalRef.style.display = 'flex';
        };
    }
    
    // Select Trump button (for when modal is accidentally closed)
    const selectTrumpBtn = document.getElementById('select-trump-btn');
    if (selectTrumpBtn) {
        selectTrumpBtn.onclick = () => {
            if (gameState.trumpSuit === null && 
                gameState.lastTrumpSelector === 'player' && 
                gameState.gamePhase === 'trump-selection') {
                showTrumpSelection();
            }
        };
    }
    
    // Close modals when clicking outside (with special handling for trump modal)
    document.addEventListener('click', (e) => {
        if (e.target.classList.contains('modal')) {
            // Close these modals when clicking outside
            if (e.target.id === 'game-log-modal' || e.target.id === 'rules-modal' || e.target.id === 'settings-modal') {
                e.target.style.display = 'none';
                return;
            }
            e.target.style.display = 'none';
            // If trump modal was closed and trump not selected, show select trump button
            if (e.target.id === 'trump-selection-modal' && gameState.trumpSuit === null) {
                updateSelectTrumpButtonVisibility();
            }
        }
    });
    
    // Initial status
    showStatus("Click 'Start Game' to begin");
}

// Start the game when page loads
document.addEventListener('DOMContentLoaded', initializeGame);
