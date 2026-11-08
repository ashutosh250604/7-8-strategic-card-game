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
    matchTarget: 3, // Match points needed to win; settings change this for the next match
    pendingMatchTarget: 3, // Applied by startGame/restartGame, never mid-match
    playedCards: [], // Track all played cards for Hard mode
    voids: { player: [], computer: [] }, // Suits a side has publicly shown out of
    lastTrick: null, // Public summary of the trick that just finished
    coinTossWinner: null, // Who won the coin toss
    isFirstRound: true, // Track if this is the first round (for coin toss)
    roundOver: false // The between-rounds gap, safe to save and resume
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
let computerWatchdog = null;

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
    GameView.showGameOver(winner, {
        player: gameState.player.score,
        computer: gameState.computer.score,
        target: gameState.matchTarget
    });
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

// The remaining deal is deliberately two steps so the table can show the
// face-down row landing before the face-up row is turned over. Both steps run
// before gamePhase becomes 'playing', so no card can be played mid-deal.
function dealRemainingFaceDown() {
    let cardIndex = 0;
    for (let i = 0; i < 5; i++) {
        gameState.player.faceDown.push(gameState.remainingCards[cardIndex++]);
        gameState.computer.faceDown.push(gameState.remainingCards[cardIndex++]);
    }
    gameState.remainingCards = gameState.remainingCards.slice(cardIndex);
}

function dealRemainingFaceUp() {
    let cardIndex = 0;
    for (let i = 0; i < 5; i++) {
        gameState.player.faceUp.push(gameState.remainingCards[cardIndex++]);
        gameState.computer.faceUp.push(gameState.remainingCards[cardIndex++]);
    }
    gameState.remainingCards = [];
}

function dealRemainingCards() {
    dealRemainingFaceDown();
    dealRemainingFaceUp();
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
    
    // Log the play. Naming a ruff or a discard makes Anne's decisions legible
    // instead of looking as if she ignored the trump suit.
    const cardDisplay = `${getCardRank(card)}${getSuitSymbol(getCardSuit(card))}`;
    const ledSuit = gameState.trick.leadSuit;
    const playedSuit = getCardSuit(card);
    if (ledSuit && playedSuit !== ledSuit) {
        addToLog(playedSuit === gameState.trumpSuit
            ? `You ruffed with ${cardDisplay}`
            : `You discarded ${cardDisplay}`);
    } else {
        addToLog(`You played ${cardDisplay}`);
    }
    
    // Add card to current trick
    gameState.trick.cards.push({
        card: card,
        player: gameState.currentPlayer
    });
    if (GameView.event) GameView.event('play', { side: 'player', card });
    
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
        showStatus("Anne is playing...");
        runBeat('computer-response', {}, computerPlay);
    }
    
    return true;
}


// Computer AI
function selectComputerTrump() {
    if (gameState.difficulty === 'hard') {
        const sampled = chooseHardTrump();
        if (sampled) { setTrump(sampled); return; }
    }
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
    // Anne's own cards cannot beat her, and a card she can see on the table is
    // already accounted for. Ignoring her own hand here made almost nothing
    // count as a master, so she never cashed the winners she was holding.
    const mine = new Set([...gameState.computer.hand, ...gameState.computer.faceUp].filter(Boolean));
    for (const c of remaining) {
        if (c !== card && getCardValue(c) > value && !mine.has(c)) {
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

// A ruff cannot be over-ruffed: when the opponent has already played a side
// suit, a trump on the table wins the trick outright. So if Anne is void in the
// led suit and holds a trump, discarding is not a style choice, it is a lost
// trick. This guard runs after every AI (easy, medium and hard) so no heuristic
// or sampler can ever hand a trick over like that again.
function enforceRuffRule(play) {
    const lead = gameState.trick.leadSuit;
    const trump = gameState.trumpSuit;
    if (!play || !lead || !trump || lead === trump) return play;
    const cards = getValidCards(gameState.computer);
    if (cards.some((entry) => getCardSuit(entry.card) === lead)) return play;
    const trumps = cards.filter((entry) => getCardSuit(entry.card) === trump);
    if (!trumps.length) return play;
    const current = gameState.trick.cards[0] && gameState.trick.cards[0].card;
    // If the player has already ruffed, only an over-ruff can win. Spending a
    // lower trump here would be a free discard, not a ruff.
    if (current && getCardSuit(current) === trump) {
        const winning = trumps.filter((entry) => getCardValue(entry.card) > getCardValue(current));
        if (!winning.length) return play;
        return winning.reduce((low, entry) =>
            getCardValue(entry.card) < getCardValue(low.card) ? entry : low
        );
    }
    if (getCardSuit(play.card) === trump) return play;
    return trumps.reduce((low, entry) =>
        getCardValue(entry.card) < getCardValue(low.card) ? entry : low
    );
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

// MEDIUM AI - a competent heuristic. It uses only public information: its own
// cards, the player's face-up row, the current trick and the played pile. It
// keeps trump for tricks that matter instead of ruffing every void.
function mediumLowest(cards) {
    return cards.reduce((low, entry) =>
        getCardValue(entry.card) < getCardValue(low.card) ? entry : low
    );
}

function mediumHighest(cards) {
    return cards.reduce((high, entry) =>
        getCardValue(entry.card) > getCardValue(high.card) ? entry : high
    );
}

// A card is a safe master when every higher card in its suit has already been
// played or is in Anne's own hand. A higher card in the player's visible row or
// hidden hand is still a threat, so the card is not a master.
function mediumIsMaster(card) {
    const suit = getCardSuit(card);
    const value = getCardValue(card);
    const mine = new Set([...gameState.computer.hand, ...gameState.computer.faceUp].filter(Boolean));
    return getRemainingCardsInSuit(suit).every((other) =>
        other === card || mine.has(other) || getCardValue(other) <= value
    );
}

function getMediumAIPlay(validCards) {
    // Medium uses the same public-information expert rules as Hard, but without
    // the determinised search. It tracks played cards, known voids, the visible
    // row and the trump count; it never peeks at a hidden card. This is a real
    // step up from the old heuristic, which could cash a master into a known
    // ruff and did not draw trumps before cashing side winners.
    return getHardHeuristicPlay(validCards);
}

// HARD AI - determinised Monte Carlo using only information a player can see.
// The computer samples the unseen hands, plays each sampled deal out with a
// simple legal policy, and picks the card with the best expected match score.
// It never reads the player's hand or either face-down pile.
const HARD_ALL_SUITS = ['hearts', 'diamonds', 'clubs', 'spades'];
const HARD_OTHER = { player: 'computer', computer: 'player' };
const HARD_META = Object.create(null);

function hardSuit(card) {
    let meta = HARD_META[card];
    if (!meta) {
        const parts = card.split('_');
        meta = HARD_META[card] = {
            suit: parts[1],
            value: { '7': 7, '8': 8, '9': 9, '10': 10, J: 11, Q: 12, K: 13, A: 14 }[parts[0]] || 0
        };
    }
    return meta.suit;
}

function hardValue(card) {
    hardSuit(card);
    return HARD_META[card].value;
}

// A ruff cannot be over-ruffed in a two-player trick: the opponent's card is
// already on the table. So when Anne is void in the led side suit and holds a
// trump, this is not a preference, it is the only play that wins the trick.
// Skipping it to "save" the trump gives away a guaranteed trick.
function hardRuff(validCards) {
    const lead = gameState.trick.leadSuit;
    const trump = gameState.trumpSuit;
    if (!lead || !trump || lead === trump) return null;
    if (validCards.some((entry) => hardSuit(entry.card) === lead)) return null;
    const trumps = validCards.filter((entry) => hardSuit(entry.card) === trump);
    if (!trumps.length) return null;
    const current = gameState.trick.cards[0] && gameState.trick.cards[0].card;
    // The player's card may already be a ruff. In that case a lower trump is
    // not a winning ruff at all; keep it and discard something else.
    if (current && hardSuit(current) === trump) {
        const winning = trumps.filter((entry) => hardValue(entry.card) > hardValue(current));
        if (!winning.length) return null;
        return winning.reduce((low, entry) => hardValue(entry.card) < hardValue(low.card) ? entry : low);
    }
    return trumps.reduce((low, entry) => hardValue(entry.card) < hardValue(low.card) ? entry : low);
}

function hardAllCards() {
    const cards = [];
    HARD_ALL_SUITS.forEach((suit) => {
        ['8', '9', '10', 'J', 'Q', 'K', 'A'].forEach((rank) => cards.push(`${rank}_${suit}`));
        if (suit === 'hearts' || suit === 'spades') cards.push(`7_${suit}`);
    });
    return cards;
}

function hardSeenCards() {
    const seen = new Set(gameState.playedCards);
    const add = (card) => { if (card) seen.add(card); };
    gameState.computer.hand.forEach(add);
    gameState.computer.faceUp.forEach(add);
    gameState.player.faceUp.forEach(add);
    gameState.trick.cards.forEach((play) => add(play.card));
    return seen;
}

function hardUnknownCards() {
    const seen = hardSeenCards();
    return hardAllCards().filter((card) => !seen.has(card));
}

function hardShuffle(cards) {
    const copy = cards.slice();
    for (let i = copy.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
}

function simLegalPlays(sim, side) {
    const data = sim.sides[side];
    const lead = sim.trick.leadSuit;
    const hasLead = !!lead && [...data.hand, ...data.faceUp].some((card) => card && hardSuit(card) === lead);
    const out = [];
    data.hand.forEach((card, index) => {
        if (card && (!hasLead || hardSuit(card) === lead)) out.push({ card, source: 'hand', index });
    });
    data.faceUp.forEach((card, index) => {
        if (card && (!hasLead || hardSuit(card) === lead)) out.push({ card, source: 'faceUp', index });
    });
    return out;
}

function simApplyPlay(sim, side, play) {
    const data = sim.sides[side];
    // Remember public voids during the playout. Without this the sampled line
    // happily leads back into a suit the opponent just showed out of, which
    // understates how punishing a ruff is and makes Anne's leads look random.
    const followedLead = sim.trick.cards.length !== 1 || hardSuit(play.card) === sim.trick.leadSuit;
    const ledSuit = sim.trick.cards.length === 1 ? sim.trick.leadSuit : null;
    if (play.source === 'hand') {
        data.hand[play.index] = null;
    } else {
        data.faceUp[play.index] = null;
        if (data.faceDown[play.index]) {
            data.faceUp[play.index] = data.faceDown[play.index];
            data.faceDown[play.index] = null;
        }
    }
    if (ledSuit && !followedLead) {
        if (!sim.voids) sim.voids = { player: [], computer: [] };
        if (!sim.voids[side].includes(ledSuit)) sim.voids[side].push(ledSuit);
    }
    sim.trick.cards.push({ card: play.card, player: side });
    if (sim.trick.cards.length === 1) sim.trick.leadSuit = hardSuit(play.card);
    sim.currentPlayer = HARD_OTHER[side];
}

// Shedding is not just "lowest card". An expert throws away from the suit they
// are shortest in: that opens a void, and a void in a two-player trick game is a
// free ruff later on. Trump is only shed when there is nothing else.
function simDiscard(sim, side, legal) {
    const trump = sim.trump;
    const side_ = legal.filter((play) => hardSuit(play.card) !== trump);
    const pool = side_.length ? side_ : legal;
    const lengths = {};
    sim.sides[side].hand.concat(sim.sides[side].faceUp).forEach((card) => {
        if (card) lengths[hardSuit(card)] = (lengths[hardSuit(card)] || 0) + 1;
    });
    return pool.reduce((best, play) => {
        const a = lengths[hardSuit(play.card)] || 0;
        const b = lengths[hardSuit(best.card)] || 0;
        if (a !== b) return a < b ? play : best;
        return hardValue(play.card) < hardValue(best.card) ? play : best;
    });
}

function simBeats(card, best, trump, lead) {
    if (!best) return true;
    const a = hardSuit(card), b = hardSuit(best);
    if (a === trump && b !== trump) return true;
    if (b === trump && a !== trump) return false;
    if (a === b) return hardValue(card) > hardValue(best);
    return a === lead && b !== lead;
}

function simResolve(sim) {
    const cards = sim.trick.cards;
    if (cards.length !== 2) return;
    let winner = cards[0];
    if (simBeats(cards[1].card, cards[0].card, sim.trump, sim.trick.leadSuit)) winner = cards[1];
    if (winner.player === 'computer') sim.computerTricks++;
    else sim.playerTricks++;
    sim.trickCount++;
    sim.trick = { cards: [], leadSuit: null };
    sim.currentPlayer = winner.player;
}

function simMasterCard(sim, side, card) {
    const suit = hardSuit(card);
    const opponent = sim.sides[HARD_OTHER[side]];
    const visible = [...opponent.hand, ...opponent.faceUp].filter(Boolean);
    const hasSuit = visible.some((c) => hardSuit(c) === suit);
    if (visible.some((c) => hardSuit(c) === suit && hardValue(c) > hardValue(card))) return false;
    // A non-trump master can still be ruffed by an opponent who is void.
    if (suit !== sim.trump && !hasSuit && visible.some((c) => hardSuit(c) === sim.trump)) return false;
    return true;
}

function simPolicy(sim, side, legal) {
    if (!legal.length) return null;
    const trump = sim.trump;
    const lead = sim.trick.leadSuit;
    const byValue = (a, b) => hardValue(a.card) - hardValue(b.card);

    if (!lead) {
        // Leading into a suit the opponent has publicly run out of is a gift:
        // they ruff it. Keep those suits for when there is no alternative.
        const oppVoids = (sim.voids && sim.voids[HARD_OTHER[side]]) || [];
        const safe = legal.filter((play) => !oppVoids.includes(hardSuit(play.card)));
        const pool = safe.length ? safe : legal;
        const masters = pool.filter((play) => simMasterCard(sim, side, play.card));
        if (masters.length) return masters.reduce((low, play) => byValue(play, low) < 0 ? play : low);
        // With a top trump and trumps still out, draw them before they ruff a
        // side-suit trick. This is the move the old policy kept missing.
        const trumps = pool.filter((play) => hardSuit(play.card) === trump);
        const opponent = sim.sides[HARD_OTHER[side]];
        const opponentTrumps = [...opponent.hand, ...opponent.faceUp]
            .filter((card) => card && hardSuit(card) === trump).length;
        const masterTrumps = trumps.filter((play) => simMasterCard(sim, side, play.card));
        if (opponentTrumps && masterTrumps.length) {
            return masterTrumps.reduce((low, play) => byValue(play, low) < 0 ? play : low);
        }
        const nonTrump = pool.filter((play) => hardSuit(play.card) !== trump);
        return (nonTrump.length ? nonTrump : pool).reduce((low, play) => byValue(play, low) < 0 ? play : low);
    }

    const current = sim.trick.cards[0] && sim.trick.cards[0].card;
    const winners = legal.filter((play) => simBeats(play.card, current, trump, lead));
    if (winners.length) {
        // Win as cheaply as possible, preferring a non-trump winner when ranks tie.
        return winners.sort((a, b) => {
            const at = hardSuit(a.card) === trump ? 1 : 0;
            const bt = hardSuit(b.card) === trump ? 1 : 0;
            return at - bt || byValue(a, b);
        })[0];
    }
    return simDiscard(sim, side, legal);
}

function simPlayOut(sim) {
    for (let guard = 0; guard < 40; guard++) {
        if (sim.trick.cards.length === 2) { simResolve(sim); continue; }
        const side = sim.currentPlayer;
        const legal = simLegalPlays(sim, side);
        if (!legal.length) {
            if (sim.trick.cards.length) { simResolve(sim); continue; }
            break;
        }
        const play = simPolicy(sim, side, legal);
        if (!play) break;
        simApplyPlay(sim, side, play);
    }
}

function simObjective(sim, ownTarget, opponentTarget) {
    const own = Math.max(0, sim.computerTricks - ownTarget);
    const opponent = Math.max(0, sim.playerTricks - opponentTarget);
    // Match points decide the game. Denying the player a point is worth more
    // than taking a risky extra point, and reaching the contract still matters
    // because it is the platform for every later point. The small trick term
    // keeps the scorer from shrugging at the early tricks.
    const madeTarget = sim.computerTricks >= ownTarget ? 0.4 : 0;
    const deniedTarget = sim.playerTricks < opponentTarget ? 0.22 : 0;
    return own - opponent * 1.4 + madeTarget + deniedTarget +
        (sim.computerTricks - sim.playerTricks) * 0.06;
}

function hardPlaySample() {
    const gs = gameState;
    const unknownAll = hardShuffle(hardUnknownCards());
    const playerHandCount = gs.player.hand.filter(Boolean).length;
    const playerDownCount = gs.player.faceDown.filter(Boolean).length;
    const computerDownCount = gs.computer.faceDown.filter(Boolean).length;
    if (unknownAll.length !== playerHandCount + playerDownCount + computerDownCount) return null;

    // A side that has publicly discarded on a suit and has no hidden row left
    // cannot still hold that suit. Filter those cards out of the sampled hand;
    // if a hidden row does remain, the void is not certain, so leave the sample
    // unconstrained (the hidden cards can still be that suit).
    const certainVoids = playerDownCount === 0 ? gs.voids.player : [];
    const handPool = unknownAll.filter((card) => !certainVoids.includes(hardSuit(card)));
    if (handPool.length < playerHandCount) return null;
    const playerHand = hardShuffle(handPool).slice(0, playerHandCount);
    const unknown = hardShuffle(unknownAll.filter((card) => !playerHand.includes(card)));

    const playerDown = [null, null, null, null, null];
    gs.player.faceDown.forEach((card, index) => { if (card) playerDown[index] = unknown.pop(); });
    const computerDown = [null, null, null, null, null];
    gs.computer.faceDown.forEach((card, index) => { if (card) computerDown[index] = unknown.pop(); });
    if (unknown.length) return null;

    return {
        trump: gs.trumpSuit,
        currentPlayer: gs.currentPlayer,
        trick: { cards: gs.trick.cards.map((play) => ({ card: play.card, player: play.player })), leadSuit: gs.trick.leadSuit },
        voids: { player: gs.voids.player.slice(), computer: gs.voids.computer.slice() },
        trickCount: gs.trickCount,
        playerTricks: gs.player.tricksWon,
        computerTricks: gs.computer.tricksWon,
        sides: {
            player: { hand: playerHand, faceUp: gs.player.faceUp.slice(), faceDown: playerDown },
            computer: { hand: gs.computer.hand.slice(), faceUp: gs.computer.faceUp.slice(), faceDown: computerDown }
        }
    };
}

function cloneSim(sim) {
    return {
        trump: sim.trump,
        currentPlayer: sim.currentPlayer,
        trick: { cards: sim.trick.cards.slice(), leadSuit: sim.trick.leadSuit },
        voids: { player: (sim.voids ? sim.voids.player : []).slice(), computer: (sim.voids ? sim.voids.computer : []).slice() },
        trickCount: sim.trickCount,
        playerTricks: sim.playerTricks,
        computerTricks: sim.computerTricks,
        sides: {
            player: { hand: sim.sides.player.hand.slice(), faceUp: sim.sides.player.faceUp.slice(), faceDown: sim.sides.player.faceDown.slice() },
            computer: { hand: sim.sides.computer.hand.slice(), faceUp: sim.sides.computer.faceUp.slice(), faceDown: sim.sides.computer.faceDown.slice() }
        }
    };
}

function hardSamples() {
    const base = Math.max(10, Math.min(160, Number(gameState.aiSamples) || 56));
    // The last few tricks decide the round and the tree is tiny there, so Anne
    // spends more samples exactly where the points are.
    const left = gameState.computer.hand.filter(Boolean).length + gameState.computer.faceUp.filter(Boolean).length;
    return left <= 4 ? base + 10 : base;
}

// Choosing trump is the single highest-leverage decision in a round. Anne only
// sees her first five cards here, so a suit she holds nothing in can never be a
// sensible call. The simulation is a tie-breaker between suits she actually has.
function chooseHardTrump() {
    const gs = gameState;
    const hand = gs.computer.hand.filter(Boolean);
    if (hand.length !== 5) return null;

    const counts = { hearts: 0, diamonds: 0, clubs: 0, spades: 0 };
    const honours = { hearts: 0, diamonds: 0, clubs: 0, spades: 0 };
    hand.forEach((card) => {
        const suit = hardSuit(card);
        counts[suit]++;
        if (hardValue(card) >= 11) honours[suit]++;
    });

    let candidates = HARD_ALL_SUITS.filter((suit) => counts[suit] >= 2 ||
        (counts[suit] >= 1 && hand.some((card) => hardSuit(card) === suit && hardValue(card) >= 13)));
    if (!candidates.length) candidates = HARD_ALL_SUITS.filter((suit) => counts[suit] >= 1);
    if (!candidates.length) return null;

    const unknownBase = hardShuffle(hardAllCards().filter((card) => !hand.includes(card)));
    if (unknownBase.length !== 25) return null;

    const samples = Math.max(18, hardSamples());
    const deals = [];
    for (let i = 0; i < samples; i++) {
        const cards = unknownBase.slice();
        deals.push({
            player: { hand: cards.splice(0, 5), faceUp: cards.splice(0, 5), faceDown: cards.splice(0, 5) },
            computer: { hand: hand.slice(), faceUp: cards.splice(0, 5), faceDown: cards.splice(0, 5) }
        });
    }

    let bestSuit = candidates[0];
    let bestScore = -Infinity;
    candidates.forEach((suit) => {
        let total = 0;
        deals.forEach((deal) => {
            const sim = {
                trump: suit, currentPlayer: 'computer',
                trick: { cards: [], leadSuit: null }, trickCount: 0,
                playerTricks: 0, computerTricks: 0,
                sides: {
                    player: { hand: deal.player.hand.slice(), faceUp: deal.player.faceUp.slice(), faceDown: deal.player.faceDown.slice() },
                    computer: { hand: deal.computer.hand.slice(), faceUp: deal.computer.faceUp.slice(), faceDown: deal.computer.faceDown.slice() }
                }
            };
            simPlayOut(sim);
            total += simObjective(sim, 8, 7);
        });
        // A small prior stops a lucky simulation from choosing a one-card suit
        // over a strong one. Length and top honours both matter in 7-8.
        const prior = (counts[suit] - 1) * 0.55 + honours[suit] * 0.28;
        const average = total / deals.length + prior;
        if (average > bestScore) { bestScore = average; bestSuit = suit; }
    });
    return bestSuit;
}

// The old heuristic remains as a fast fallback for unusual states (for example
// a replay or a test that has deliberately removed cards).
function getHardHeuristicPlay(validCards) {
    const trump = gameState.trumpSuit;
    const lead = gameState.trick.leadSuit;
    const lowest = (list) => list.reduce((a, b) => hardValue(b.card) < hardValue(a.card) ? b : a);
    const mine = new Set([...gameState.computer.hand, ...gameState.computer.faceUp].filter(Boolean));

    // A card is a master when no higher card of that suit is still unseen, and
    // (for a side suit) the player is not known to be void and able to ruff it.
    const master = (card) => {
        const suit = hardSuit(card);
        const value = hardValue(card);
        const higher = getRemainingCardsInSuit(suit)
            .filter((c) => c !== card && getCardValue(c) > value && !mine.has(c));
        return higher.length === 0;
    };

    // ---- Leading -------------------------------------------------------
    if (!lead) {
        // Never lead into a suit the player has publicly run out of: that is a
        // free ruff for them.
        const playerVoids = gameState.voids.player || [];
        const safe = validCards.filter((entry) => !playerVoids.includes(hardSuit(entry.card)));
        const pool = safe.length ? safe : validCards;

        // Cash a side-suit master first, but not one the player can ruff.
        const sideMasters = pool.filter((entry) => hardSuit(entry.card) !== trump && master(entry.card));
        if (sideMasters.length) return lowest(sideMasters);

        // With the top trump and trumps still out, draw them: each round of
        // trumps turns a later side-suit winner into cash.
        const trumps = pool.filter((entry) => hardSuit(entry.card) === trump);
        if (trumps.length) {
            const unseenTrumps = getRemainingCardsInSuit(trump).filter((c) => !mine.has(c)).length;
            const masterTrumps = trumps.filter((entry) => master(entry.card));
            if (masterTrumps.length && unseenTrumps > 0) return lowest(masterTrumps);
        }

        const trumpMasters = trumps.filter((entry) => master(entry.card));
        if (trumpMasters.length) return lowest(trumpMasters);

        // Otherwise lead low from a suit the player still has to follow.
        const side = pool.filter((entry) => hardSuit(entry.card) !== trump);
        return lowest(side.length ? side : pool);
    }

    // ---- Following -----------------------------------------------------
    // This half of the decision is provable rather than speculative:
    //   * if a legal card beats the card on the table, the cheapest one wins a
    //     trick for the least value (a non-trump beats a trump at equal cost);
    //   * if nothing beats it, the trick is already lost, so shed the lowest
    //     card and keep the winners.
    // Simulating here only ever added noise on top of that.
    const current = gameState.trick.cards[0] && gameState.trick.cards[0].card;
    if (current) {
        const winners = validCards.filter((entry) => simBeats(entry.card, current, trump, lead));
        if (winners.length) {
            return winners.slice().sort((a, b) => {
                const at = hardSuit(a.card) === trump ? 1 : 0;
                const bt = hardSuit(b.card) === trump ? 1 : 0;
                return at - bt || hardValue(a.card) - hardValue(b.card);
            })[0];
        }
    }
    // The trick is lost. Preserve a trump for a later trick when the rules
    // allow a discard; if every legal card is a trump, the lowest still goes.
    const nonTrump = validCards.filter((entry) => hardSuit(entry.card) !== trump);
    return lowest(nonTrump.length ? nonTrump : validCards);
}

// Only the plausible lines are searched. On a 6-7 card turn that is every
// legal card; with a bigger choice the extremes, the lead suit, the trumps, the
// cheapest winner and the expert heuristic are enough to cover the real options.
function hardCandidatePlays(validCards) {
    if (validCards.length <= 6) return validCards.slice();
    const lead = gameState.trick.leadSuit;
    const trump = gameState.trumpSuit;
    const sorted = validCards.slice().sort((a, b) => hardValue(a.card) - hardValue(b.card));
    const picks = [];
    const add = (play) => {
        if (play && !picks.some((entry) => entry.card === play.card)) picks.push(play);
    };
    add(sorted[0]);
    add(sorted[sorted.length - 1]);
    if (lead) {
        const follow = sorted.filter((entry) => hardSuit(entry.card) === lead);
        if (follow.length) add(follow[0]);
        const current = gameState.trick.cards[0] && gameState.trick.cards[0].card;
        if (current) {
            const winners = validCards.filter((entry) => simBeats(entry.card, current, trump, lead));
            if (winners.length) add(winners.reduce((low, entry) => hardValue(entry.card) < hardValue(low.card) ? entry : low));
        }
    }
    const trumps = sorted.filter((entry) => hardSuit(entry.card) === trump);
    if (trumps.length) { add(trumps[0]); add(trumps[trumps.length - 1]); }
    add(getHardHeuristicPlay(validCards));
    return picks.slice(0, 7);
}

function getHardAIPlay(validCards) {
    if (!validCards.length) return null;
    // Forced cards need no simulation at all.
    if (validCards.length === 1) return validCards[0];
    // A guaranteed trick is worth more than any speculative line the sampler
    // could prefer, and skipping the ruff was the visible hard-mode blunder.
    const ruff = hardRuff(validCards);
    if (ruff) return ruff;
    const expert = getHardHeuristicPlay(validCards);
    if (!gameState.trumpSuit) return expert;
    // Following a trick is solved by the exact rules in getHardHeuristicPlay.
    // Only the lead is a whole-round plan, so only the lead is simulated. This
    // also keeps Anne's answers instant instead of randomly "creative".
    if (gameState.trick.leadSuit) return expert;

    const ownTarget = GameEngine.getTrickTarget('computer') || 7;
    const opponentTarget = GameEngine.getTrickTarget('player') || 8;
    const samples = hardSamples();
    const deals = [];
    for (let i = 0; i < samples; i++) {
        const deal = hardPlaySample();
        if (deal) deals.push(deal);
    }
    if (!deals.length) return expert;

    const candidates = hardCandidatePlays(validCards);
    let best = expert;
    let bestScore = -Infinity;
    candidates.forEach((candidate) => {
        let total = 0;
        deals.forEach((deal) => {
            const sim = cloneSim(deal);
            simApplyPlay(sim, 'computer', candidate);
            simPlayOut(sim);
            total += simObjective(sim, ownTarget, opponentTarget);
        });
        const average = total / deals.length;
        // A hair of preference for the expert line breaks near-ties without
        // overriding a line the simulation clearly prefers.
        const score = average + (candidate.card === (expert && expert.card) ? 0.01 : 0);
        if (score > bestScore + 1e-9) { bestScore = score; best = candidate; }
    });
    return best || expert;
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

    // Watchdog: a cancelled beat must never leave the table waiting on Anne.
    // If her turn is still open after the beat window, release the flag and try
    // once more. The guard conditions in computerPlay stop a double play.
    if (computerWatchdog) clearTimeout(computerWatchdog);
    computerWatchdog = setTimeout(() => {
        computerWatchdog = null;
        if (gameState.currentPlayer !== 'computer' || gameState.gamePhase !== 'playing' || gameState.trick.cards.length >= 2) return;
        gameState.computerThinking = false;
        showThinking(false);
        computerPlay();
    }, 7000);
    
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
        
        if (computerWatchdog) { clearTimeout(computerWatchdog); computerWatchdog = null; }
        const play = enforceRuffRule(getComputerPlay());
        if (play) {
            // Play the selected card
            const currentPlayerData = gameState.computer;
            let card = play.card;
            
            // Log the computer play, including a ruff or a discard.
            const cardDisplay = `${getCardRank(card)}${getSuitSymbol(getCardSuit(card))}`;
            const ledSuit = gameState.trick.leadSuit;
            const playedSuit = getCardSuit(card);
            if (ledSuit && playedSuit !== ledSuit) {
                addToLog(playedSuit === gameState.trumpSuit
                    ? `Anne ruffed with ${cardDisplay}`
                    : `Anne discarded ${cardDisplay}`, 'computer-action');
            } else {
                addToLog(`Anne played ${cardDisplay}`, 'computer-action');
            }
            
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
            if (GameView.event) GameView.event('play', { side: 'computer', card });
            
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
        addToLog(`Anne won the trick with ${winningCard}.`, 'trick-lost');
    }
    
    // Remember the public shape of the trick for Anne's reactions and for the
    // hard AI's card reading. A discard on an off-suit is only proof of a void
    // when that side has no hidden row left, so record nothing it could still
    // legally hold in a face-down card.
    const leadSuit = gameState.trick.leadSuit;
    gameState.trick.cards.forEach((play) => {
        if (leadSuit && getCardSuit(play.card) !== leadSuit) {
            const data = gameState[play.player];
            const hiddenLeft = data.faceDown.some(Boolean);
            if (!hiddenLeft && !gameState.voids[play.player].includes(leadSuit)) {
                gameState.voids[play.player].push(leadSuit);
            }
        }
    });
    const playerCard = gameState.trick.cards.find((play) => play.player === 'player').card;
    const computerCard = gameState.trick.cards.find((play) => play.player === 'computer').card;
    const trumpSuit = gameState.trumpSuit;
    gameState.lastTrick = {
        winner,
        leadSuit,
        playerCard,
        computerCard,
        trumpSuit,
        trickNumber: gameState.trickCount + 1,
        playerTricks: gameState.player.tricksWon,
        computerTricks: gameState.computer.tricksWon,
        playerRuffed: getCardSuit(playerCard) !== leadSuit && getCardSuit(playerCard) === trumpSuit,
        anneRuffed: getCardSuit(computerCard) !== leadSuit && getCardSuit(computerCard) === trumpSuit
    };
    if (GameView.event) GameView.event('trick', gameState.lastTrick);

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
                showStatus("Anne leads next trick");
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
    
    const message = `Round ${gameState.roundNumber} complete. You: +${scores.playerRoundScore} points, Anne: +${scores.computerRoundScore} points`;
    if (GameView.event) GameView.event('round', {
        ...scores,
        roundNumber: gameState.roundNumber,
        playerTricks: gameState.player.tricksWon,
        computerTricks: gameState.computer.tricksWon,
        playerScore: gameState.player.score,
        computerScore: gameState.computer.score,
        target: gameState.matchTarget
    });
    showStatus(message);
    addToLog(message);
    updateDisplay(); // refresh the scoreboard with the round's points (view only, no state change)
    
    // Check for game end
    if (checkGameEnd()) {
        return;
    }

    // The score and table are settled before the short reveal beat. Save here
    // so closing the tab during that beat still comes back to this round result.
    gameState.roundOver = true;
    persistMatch();
    
    // Prepare for next round
    runBeat('round-end', {}, () => {
        GameView.setNewRoundButton(true);
        showStatus("Click 'New Round' to continue");
        persistMatch();
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
    const target = gameState.matchTarget;
    if (gameState.player.score >= target || gameState.computer.score >= target) {
        const playerWon = gameState.player.score >= target;
        const winner = playerWon ? 'Player' : 'Computer';
        gameState.gameOver = true;
        gameState.roundOver = false;
        clearSavedMatch();
        addToLog(`Match complete. ${winner === 'Player' ? 'You win' : 'Anne wins'} ${playerWon ? gameState.player.score : gameState.computer.score} to ${playerWon ? gameState.computer.score : gameState.player.score} (first to ${target}).`, 'trick-won');
        if (GameView.event) GameView.event('match', { winner, playerScore: gameState.player.score, computerScore: gameState.computer.score, target });
        showGameOver(winner);
        return true;
    }
    return false;
}

function startNewRound() {
    // The completed round keeps its number while its result is on screen. The
    // next round is numbered only when the player actually starts it.
    if (gameState.roundOver) gameState.roundNumber++;
    gameState.roundOver = false;
    // Do not let a refresh during the next deal reopen the completed result.
    clearSavedMatch();

    // Reset trick data
    gameState.player.wonTricks = [];
    gameState.computer.wonTricks = [];
    gameState.player.tricksWon = 0;
    gameState.computer.tricksWon = 0;
    gameState.trick = { cards: [], leadSuit: null };
    gameState.trickCount = 0;
    gameState.trumpSuit = null;
    gameState.playedCards = []; // Reset played cards tracking
    gameState.voids = { player: [], computer: [] };
    gameState.lastTrick = null;
    gameState.remainingCards = [];
    GameView.setNewRoundButton(false);
    updateDisplay();

    // The first round of a match opens with the toss, which decides who calls
    // trump. Every round - including this first one - is then riffled before it
    // is dealt: the shuffle is the start of a round, not a decoration on the
    // start button.
    if (gameState.isFirstRound) {
        gameState.gamePhase = 'coin-toss';
        updateDisplay();
        showCoinToss();
        return;
    }

    shuffleThenDeal(continueAfterCoinToss);
}

// Riffle the pack, then deal the opening five. The shuffle is a presentation
// beat: it never touches the deck, and a restart drops the continuation.
function shuffleThenDeal(next) {
    gameState.gamePhase = 'shuffling';
    updateDisplay();
    showStatus('Shuffling the deck...');
    runBeat('shuffle', {}, () => {
        // runBeat already drops a continuation from a superseded session (a
        // restart), so only a finished match needs its own guard here.
        if (gameState.gameOver) return;
        dealInitialCards();
        if (GameView.event) GameView.event('deal', { roundNumber: gameState.roundNumber });
        next();
    });
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

        // Close modal and continue once the result has been shown: the match
        // opens with the toss, then the pack is riffled for the first deal.
        runBeat('coin-result', { result, playerWins }, () => {
            GameView.hideCoinToss();
            if (GameView.event) GameView.event('coin', { result, playerWins });
            shuffleThenDeal(continueAfterCoinToss);
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
        addToLog(`Anne selected ${suit} ${suitSymbol} as trump. Anne goes first.`, 'trump-selection');
        showStatus("Anne selected trump. Dealing the remaining cards...");
    } else {
        addToLog(`You selected ${suit} ${suitSymbol} as trump. You go first.`, 'trump-selection');
        showStatus("You selected trump. Dealing the remaining cards...");
    }
    
    if (GameView.event) GameView.event('trump', { suit, selector: gameState.lastTrumpSelector });

    // Face-down row first, then the face-up row, then play may begin.
    dealRemainingFaceDown();
    updateDisplay();
    runBeat('deal-face-down', {}, () => {
        dealRemainingFaceUp();
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
    if (gameState.gameStarted && !gameState.gameOver) return;
    clearSavedMatch();
    gameState.gameStarted = true;
    gameState.gameOver = false;
    gameState.matchTarget = gameState.pendingMatchTarget;
    // startNewRound resets the table and, for the first round of a match, opens
    // with the toss. The shuffle that follows the toss is its own beat.
    gameState.gamePhase = 'setup';
    GameView.setStartButton(false);
    showStatus('Toss for the deal...');
    startNewRound();
}

function restartGame() {
    // Cancel everything the previous game still has pending, and clear the flags
    // that those cancelled continuations would have cleared themselves.
    flowSession++;
    if (computerWatchdog) { clearTimeout(computerWatchdog); computerWatchdog = null; }
    gameState.computerThinking = false;
    gameState.resolvingTrick = false;

    // Reset all game state (but keep difficulty)
    gameState.player.score = 0;
    gameState.computer.score = 0;
    gameState.matchTarget = gameState.pendingMatchTarget;
    gameState.roundNumber = 1;
    gameState.gameOver = false;
    gameState.gameStarted = false;
    gameState.lastTrumpSelector = null;
    gameState.gamePhase = 'setup';
    gameState.trumpSuit = null;
    gameState.playedCards = [];
    gameState.voids = { player: [], computer: [] };
    gameState.lastTrick = null;
    gameState.roundOver = false;
    gameState.isFirstRound = true;  // Reset for coin toss
    gameState.coinTossWinner = null;

    clearSavedMatch();

    GameView.resetForRestart();

    // Clear and reset log
    clearLog();
    addToLog('Game reset. Deal the cards to begin.');

    showStatus('Click "Deal the cards" to begin');
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
    if (!['easy', 'medium', 'hard'].includes(difficulty)) return;
    gameState.difficulty = difficulty;
    addToLog(`Anne's difficulty is now ${difficulty.toUpperCase()}. It applies immediately.`);
}

// Match target is deliberately deferred: changing it must never move the goal
// line in the middle of a match.
function setMatchTarget(target) {
    const value = Number(target);
    if (![3, 5, 7].includes(value)) return false;
    gameState.pendingMatchTarget = value;
    addToLog(`Match target set to ${value} points. It applies to the next match.`);
    return true;
}

function getMatchTarget() {
    return gameState.matchTarget;
}

function ready() {
    addToLog("Game ready - Deal the cards to begin");
    showStatus('Click "Deal the cards" to begin');
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

// ---------------------------------------------------------------------------
// Saved match (local only)
// ---------------------------------------------------------------------------
// A checkpoint is a settled turn, not an animation frame. We never store a
// half-dealt pack, a mid-trick resolution, or Anne's pending thinking state, so
// restoring can never duplicate a card or skip the computer's reply. The save
// is small, local to this browser, and deliberately validated before it reaches
// the engine: localStorage is user-editable, not trusted input.
const MATCH_SAVE_KEY = '78-match-v1';
const MATCH_SAVE_VERSION = 1;
const MATCH_SAVE_SUITS = ['hearts', 'diamonds', 'clubs', 'spades'];
let savedCardIds = null;

function savedCardSet() {
    if (!savedCardIds) savedCardIds = new Set(createDeck());
    return savedCardIds;
}

function readSavedCardArray(value, max) {
    if (!Array.isArray(value) || value.length > max) return null;
    const cards = [];
    for (const card of value) {
        if (card === null || card === undefined) cards.push(null);
        else if (typeof card === 'string' && savedCardSet().has(card)) cards.push(card);
        else return null;
    }
    return cards;
}

function readSavedSide(value) {
    if (!value || typeof value !== 'object') return null;
    const hand = readSavedCardArray(value.hand, 5);
    const faceUp = readSavedCardArray(value.faceUp, 5);
    const faceDown = readSavedCardArray(value.faceDown, 5);
    if (!hand || !faceUp || !faceDown) return null;
    if (!Number.isInteger(value.score) || value.score < 0 || value.score > 999) return null;
    if (!Number.isInteger(value.tricksWon) || value.tricksWon < 0 || value.tricksWon > 15) return null;
    return {
        hand, faceUp, faceDown,
        score: value.score,
        tricksWon: value.tricksWon,
        wonTricks: []
    };
}

function readSavedTrick(value, currentPlayer) {
    if (!value || typeof value !== 'object' || !Array.isArray(value.cards) || value.cards.length > 1) return null;
    const cards = [];
    for (const play of value.cards) {
        if (!play || typeof play !== 'object' || (play.player !== 'player' && play.player !== 'computer')) return null;
        if (!savedCardSet().has(play.card)) return null;
        cards.push({ card: play.card, player: play.player });
    }
    const leadSuit = value.leadSuit === null ? null :
        (typeof value.leadSuit === 'string' && MATCH_SAVE_SUITS.includes(value.leadSuit) ? value.leadSuit : undefined);
    if (leadSuit === undefined) return null;
    if (cards.length === 1) {
        if (leadSuit !== getCardSuit(cards[0].card)) return null;
        if (cards[0].player === currentPlayer) return null;
    } else if (leadSuit !== null) {
        return null;
    }
    return { cards, leadSuit };
}

function readSavedVoids(value) {
    if (!value || typeof value !== 'object') return null;
    const voids = { player: [], computer: [] };
    for (const side of ['player', 'computer']) {
        if (!Array.isArray(value[side])) return null;
        const suits = [];
        for (const suit of value[side]) {
            if (!MATCH_SAVE_SUITS.includes(suit) || suits.includes(suit)) return null;
            suits.push(suit);
        }
        voids[side] = suits;
    }
    return voids;
}

function readSavedPlayedCards(value) {
    if (!Array.isArray(value) || value.length > 30) return null;
    const cards = [];
    for (const card of value) {
        if (!savedCardSet().has(card) || cards.includes(card)) return null;
        cards.push(card);
    }
    return cards;
}

function parseSavedMatch(value) {
    if (!value || value.v !== MATCH_SAVE_VERSION || !value.state || typeof value.state !== 'object') return null;
    const raw = value.state;
    if (raw.gamePhase !== 'trump-selection' && raw.gamePhase !== 'playing') return null;
    if (raw.currentPlayer !== 'player' && raw.currentPlayer !== 'computer') return null;
    if (raw.lastTrumpSelector !== 'player' && raw.lastTrumpSelector !== 'computer') return null;
    if (!Number.isInteger(raw.roundNumber) || raw.roundNumber < 1 || raw.roundNumber > 99) return null;
    if (!Number.isInteger(raw.trickCount) || raw.trickCount < 0 || raw.trickCount > 15) return null;
    if (![3, 5, 7].includes(raw.matchTarget)) return null;
    const player = readSavedSide(raw.player);
    const computer = readSavedSide(raw.computer);
    if (!player || !computer) return null;
    const trick = readSavedTrick(raw.trick, raw.currentPlayer);
    if (!trick) return null;
    const voids = readSavedVoids(raw.voids);
    const playedCards = readSavedPlayedCards(raw.playedCards || []);
    const remainingCards = readSavedCardArray(raw.remainingCards || [], 20);
    if (!voids || !playedCards || !remainingCards) return null;
    if (raw.gamePhase === 'trump-selection') {
        if (raw.trumpSuit !== null || remainingCards.length < 10) return null;
        if (player.hand.filter(Boolean).length !== 5 || computer.hand.filter(Boolean).length !== 5) return null;
    } else if (!MATCH_SAVE_SUITS.includes(raw.trumpSuit)) {
        return null;
    }
    const active = [
        ...player.hand, ...player.faceUp, ...player.faceDown,
        ...computer.hand, ...computer.faceUp, ...computer.faceDown,
        ...trick.cards.map((play) => play.card)
    ].filter(Boolean);
    if (new Set(active).size !== active.length) return null;
    if (new Set(remainingCards.filter(Boolean)).size !== remainingCards.filter(Boolean).length) return null;
    if (trick.cards.length && raw.gamePhase !== 'playing') return null;
    let roundOver = raw.roundOver === true;
    if (roundOver && (trick.cards.length || active.some(Boolean))) return null;
    if (!roundOver && raw.gamePhase === 'playing' && !active.length) {
        if (raw.trickCount >= 15) roundOver = true;
        else return null;
    }
    return {
        deck: [],
        player, computer,
        trumpSuit: raw.trumpSuit,
        currentPlayer: raw.currentPlayer,
        trick,
        gameStarted: true,
        gamePhase: raw.gamePhase,
        gameOver: false,
        trickCount: raw.trickCount,
        lastRoundWinner: null,
        resolvingTrick: false,
        lastTrumpSelector: raw.lastTrumpSelector,
        computerThinking: false,
        roundNumber: raw.roundNumber,
        difficulty: gameState.difficulty,
        matchTarget: raw.matchTarget,
        pendingMatchTarget: gameState.pendingMatchTarget,
        playedCards,
        voids,
        lastTrick: null,
        coinTossWinner: null,
        isFirstRound: false,
        roundOver,
        remainingCards
    };
}

function currentMatchSnapshot() {
    const gs = gameState;
    if (!gs.gameStarted || gs.gameOver) return null;
    if (gs.gamePhase !== 'trump-selection' && gs.gamePhase !== 'playing') return null;
    if (gs.resolvingTrick || gs.computerThinking) return null;
    if (gs.gamePhase === 'trump-selection') {
        if (gs.lastTrumpSelector !== 'player' || gs.currentPlayer !== 'player') return null;
        if (gs.player.hand.filter(Boolean).length !== 5) return null;
    } else {
        if (!gs.trumpSuit || !gs.lastTrumpSelector) return null;
        if (gs.trick.cards.length > 1) return null;
    }
    const side = (data) => ({
        hand: data.hand.slice(),
        faceUp: data.faceUp.slice(),
        faceDown: data.faceDown.slice(),
        score: data.score,
        tricksWon: data.tricksWon
    });
    return {
        v: MATCH_SAVE_VERSION,
        savedAt: Date.now(),
        state: {
            player: side(gs.player),
            computer: side(gs.computer),
            trumpSuit: gs.trumpSuit,
            currentPlayer: gs.currentPlayer,
            trick: {
                cards: gs.trick.cards.map((play) => ({ card: play.card, player: play.player })),
                leadSuit: gs.trick.leadSuit
            },
            gamePhase: gs.gamePhase,
            trickCount: gs.trickCount,
            lastTrumpSelector: gs.lastTrumpSelector,
            roundNumber: gs.roundNumber,
            matchTarget: gs.matchTarget,
            playedCards: gs.playedCards.slice(),
            voids: { player: gs.voids.player.slice(), computer: gs.voids.computer.slice() },
            remainingCards: (gs.remainingCards || []).slice(),
            roundOver: !!gs.roundOver
        }
    };
}

function persistMatch() {
    if (typeof localStorage === 'undefined') return false;
    if (gameState.gameOver) { clearSavedMatch(); return false; }
    const snapshot = currentMatchSnapshot();
    if (!snapshot) return false;
    try {
        localStorage.setItem(MATCH_SAVE_KEY, JSON.stringify(snapshot));
        return true;
    } catch (e) {
        // Private mode, a full quota, or file:// with storage disabled.
        return false;
    }
}

function clearSavedMatch() {
    try { localStorage.removeItem(MATCH_SAVE_KEY); } catch (e) { /* storage unavailable */ }
}

function readSavedMatch() {
    try {
        const raw = localStorage.getItem(MATCH_SAVE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        const state = parseSavedMatch(parsed);
        if (!state) clearSavedMatch();
        return state;
    } catch (e) {
        clearSavedMatch();
        return null;
    }
}

let saveTimer = null;
function queueMatchSave() {
    if (saveTimer) return;
    saveTimer = setTimeout(() => {
        saveTimer = null;
        persistMatch();
    }, 60);
}

document.addEventListener('gameview:render', queueMatchSave);
window.addEventListener('pagehide', persistMatch);
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') persistMatch();
});

function restoreSavedGame() {
    const saved = readSavedMatch();
    if (!saved) return false;

    // A restored table is a new flow: cancel anything the old page left in a
    // timer and clear the transient flags before mounting settled cards.
    flowSession++;
    if (computerWatchdog) { clearTimeout(computerWatchdog); computerWatchdog = null; }
    const difficulty = gameState.difficulty;
    const pendingTarget = gameState.pendingMatchTarget;
    Object.assign(gameState, saved);
    gameState.difficulty = difficulty;
    gameState.pendingMatchTarget = pendingTarget;
    gameState.gameStarted = true;
    gameState.gameOver = false;
    gameState.resolvingTrick = false;
    gameState.computerThinking = false;
    gameState.coinTossWinner = null;
    gameState.lastTrick = null;
    gameState.isFirstRound = false;
    gameState.player.wonTricks = [];
    gameState.computer.wonTricks = [];

    GameView.resetForRestart();
    GameView.setStartButton(false);
    addToLog('Saved match restored. Your table is exactly where you left it.');
    updateDisplay();
    GameView.toast('Match restored');

    if (gameState.roundOver) {
        GameView.setNewRoundButton(true);
        showStatus("Click 'New Round' to continue");
        return true;
    }
    if (gameState.gamePhase === 'trump-selection') {
        showStatus('Choose trump to continue the restored round');
        showTrumpSelection();
        return true;
    }
    if (gameState.currentPlayer === 'computer') {
        showStatus('Anne is playing...');
        const session = flowSession;
        // Let the restored cards settle before the AI's visible thinking beat.
        setTimeout(() => {
            if (session !== flowSession || gameState.gameOver || gameState.gamePhase !== 'playing' ||
                gameState.currentPlayer !== 'computer' || gameState.trick.cards.length >= 2) return;
            computerPlay();
        }, 220);
        return true;
    }
    showStatus(gameState.trick.cards.length ? 'Your turn to play' : 'You lead the next trick');
    return true;
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
    setMatchTarget,
    getMatchTarget,
    restoreSavedGame,
    hasSavedMatch: () => !!readSavedMatch(),
    clearSavedMatch,
    saveKey: MATCH_SAVE_KEY,
    reopenTrumpSelection,
    updateSelectTrumpButtonVisibility,
    ready
};
