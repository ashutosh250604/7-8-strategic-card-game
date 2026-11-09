/*
 * character.js - the table's host and her local dialogue.
 *
 * Anne is a presentation-only character. She listens to public game events
 * (a trick, a ruff, a trump call, a round result), reacts with a short spoken
 * line and a mood, and never changes the deal, a card, a score or the AI.
 *
 * Two rules keep her from sounding like a machine:
 *   - every category is a bag. Each line is used once before any of them
 *     repeats, and a fresh bag never opens with the line that just played;
 *   - the line is chosen with the situation in hand (the score, the margin,
 *     how far into the round, the trump suit), so the same trick produces a
 *     different sentence in a 4-1 comeback than in a 1-4 rout;
 *   - anything she can only say once is announced once. The trick target and
 *     the end of the deal are tracked, so she cannot repeat herself while a
 *     side sits on its target, and a run of six tricks is never called three.
 * The registry is shaped so a future table can add another host without
 * changing the seat, result screen or tutorial chrome.
 */
(function () {
    'use strict';

    const $ = (id) => document.getElementById(id);
    const SUIT = { hearts: 'hearts', diamonds: 'diamonds', clubs: 'clubs', spades: 'spades' };
    const SYMBOL = { hearts: '♥', diamonds: '♦', clubs: '♣', spades: '♠' };

    // Short, warm, a little competitive. One idea per line so it reads at a
    // glance while a card is in the air.
    const LINES = {
        welcome: [
            'There you are. Pull up a chair, I have been keeping it warm.',
            'First to {target} points takes the evening. Shall we?',
            'New face at my table. I am Anne. I deal, I play, I talk. A lot.',
            'Sit down, sit down. I will try to be gracious when I win.',
            'You brought your luck? Good. I brought mine, and mine is smug.',
            'I have been shuffling all day waiting for someone interesting. Here you are.',
            'Careful, I am competitive, and I remember every card you show me.',
            'Tea is imaginary, the cards are real, and I am watching.',
            'Five cards hidden, five showing. It is the hidden ones that decide things.',
            'My table, my cards, your nerves. First to {target}.',
            'Sit. The shuffle is done, the evening is young, and I do not like losing.',
            'Watch my discards, friend. Everyone forgets the discards.'
        ],
        roundStart: [
            'Round {round}. {p} to you, {c} to me. Let us make it interesting.',
            'Fresh deal. You have {p}, I have {c}. Plenty of time for both of us to regret something.',
            'Here we go again. {p}–{c}. I have a good feeling about this one. For me.',
            'Round {round}, cards out. Try not to make it easy for me.',
            'Scoreboard says {p}–{c}. I say: not for long.',
            'Deal {round}. I promise to be gracious. Mostly.',
            'New cards, same table. {p}–{c} and I am still smiling.',
            'Deal {round}. {p}–{c}. I have been thinking about the last one.',
            'Cards are out. {p}–{c}. Watch your trumps, I am watching mine.',
            'Another deal, another chance for one of us to be lucky. {p}–{c}.',
            'Round {round}. I shuffled badly on purpose. Probably.',
            '{p}–{c}, and I will say this once: I am not tired yet.'
        ],
        coinPlayer: [
            'You won the toss. Go on, pick a suit before I change my mind.',
            'Your call, friend. Make it a good one.',
            'Heads or tails, you take it. Now choose something you can defend.',
            'Well. The coin likes you. Use that wisely.',
            'Your toss, your trump. I would pick the suit I can actually win with.',
            'You are choosing first. Enjoy it, it does not happen often.',
            'The coin went your way. Do something interesting with it.',
            'Fine, you pick. I will be over here, planning.'
        ],
        coinAnne: [
            'Mine. I will pick the suit, then. Try not to look nervous.',
            'I won the toss. Ooh, this is going to be fun.',
            'The coin came to me. I do like being first.',
            'My toss. I have been waiting all day to say that.',
            'Tails, heads, whatever it was, it liked me better.',
            'I get the trump. I already know which one. Do you?',
            'The toss is mine, and so is the first decision.',
            'Good. I would rather choose than guess.'
        ],
        trumpPrompt: [
            'Pick a suit you can defend. I will be watching it.',
            'Look at your five cards. Which suit feels like home?',
            'Choose wisely. I am absolutely counting.',
            'Your trump. Take your time, I have nowhere to be.',
            'The suit you name is the suit I will attack. No pressure.',
            'Go on then. Name it.',
            'Five cards in hand. One of those suits is lying to you.',
            'Pick the suit you would bet on. Then bet on it.'
        ],
        trumpPlayer: [
            '{suit}? Ooh, I like it. Let us see if it loves you back.',
            '{suit} it is. Bold. I respect bold.',
            'You called {suit} {symbol}. Noted. Carefully noted.',
            '{suit} {symbol}. Brave, with five cards in hand.',
            'So {suit} is the plan. I have heard worse plans.',
            '{suit}. Fine. Now try to keep it.',
            '{suit} {symbol}. I will be counting them, you know.',
            'Trump is {suit}. I hope you are holding more than one.',
            '{suit}. Interesting choice. I would not call it a good one.',
            'Alright, {suit} {symbol}. Let us see who rues it.'
        ],
        trumpAnne: [
            '{suit} are trump, friend. Try to keep up.',
            'I am calling {suit} {symbol}. This should be fun.',
            '{suit} {symbol}. My suit tonight. Good luck to us both.',
            '{suit}, and I am not sorry about it.',
            'I looked at my hand and it practically shouted {suit}.',
            '{suit} {symbol}. Do try to enjoy yourself.',
            '{suit}. I had three of them screaming at me.',
            'Trump: {suit} {symbol}. I have plans for those.',
            '{suit} it is. I would apologise, but it is such a good suit.',
            '{suit} {symbol}. I am going to enjoy this one.'
        ],
        trickPlayer: [
            'Yours. Nicely read.',
            'Ooh, smooth. I am paying attention now.',
            'Fine, take it. I am still here.',
            'That was a good one. Do it again, I dare you.',
            'You saw that coming and I did not. Annoying.',
            'Good card. Rude card. Same thing.',
            'Take your trick, I will take notes.',
            'Hm. You are better at this than you look.',
            'I let you have that one. That is my story.',
            'Well played. Do not get used to it.',
            'You read me. I hate that. Keep going.',
            'Yours. I am not sulking. I am thinking.',
            'That is one for you. I am still counting, though.',
            'Clean. I would say lucky, but it was not.',
            'Right. Notes taken, grudge filed.',
            'You wanted that trick. You took it. Rude.',
            'Ugh. Fair. Ugh.',
            'Keep winning them like that and I will have to concentrate.',
            'That was the trick I had pencilled in for myself.',
            'Nice. Do not look so pleased, we are not finished.',
            'You are quicker than you let on.',
            'Mine was the wrong card. Yours was the right one. Noted.',
            'Taken. I am beginning to see how you play.',
            'One for you. The table is listening.'
        ],
        trickAnne: [
            'Mine, thank you.',
            'I will take that one.',
            'That trick had my name on it.',
            'One for me. No hard feelings, right?',
            'Ah, there it is. I was wondering when.',
            'Thank you, I will be keeping this.',
            'That went exactly as I hoped.',
            'Small card, big trouble. For you.',
            'I have been saving that one.',
            'Tidy. On we go.',
            'Do not look at me like that.',
            'One more for the pile.',
            'Mine. I do like this part of the evening.',
            'The cards did the work there. I just happened to hold them.',
            'Careful now, I am warming up.',
            'I had that planned two tricks ago.',
            'Sorry. Not really, but I said it.',
            'Right where I wanted it.',
            'Mine again. You should have led something else.',
            'There we are. Order restored.',
            'That is what the trumps are for, friend.',
            'I will take the good tricks and you can keep the good manners.',
            'One to me. Try to look like you expected it.',
            'Mine. I am not even out of breath.'
        ],
        ruffPlayer: [
            'A ruff. Look at you, playing proper cards.',
            'Ruffing me? Rude. Also very good.',
            'Ooh, a trump out of nowhere. Noted.',
            'That is a ruff. The good kind, unfortunately.',
            'You were out of that suit and you made me pay for it.',
            'I felt that one from my side of the table.',
            'A ruff. Now I have to think about your voids as well.',
            'You kept a trump back for exactly that. Clever.',
            'Trump from behind me. I did not see it coming.',
            'That is how you punish a lead. Fair enough.'
        ],
        ruffAnne: [
            'Ruff. I was out of that suit, lucky me.',
            'Sorry. No {suit}, so I borrowed a trump.',
            'That is what trump is for, friend.',
            'No {suit}? Then {trump}. Simple.',
            'I could not follow, so I made it mine.',
            'Out of {suit}, in with a bang.',
            'No {suit} on this side. So: {trump}.',
            'I was saving this trump for exactly this moment.',
            'You led my void. Generous of you.',
            'Ruff. The little cards do the shouting here.'
        ],
        discardAnne: [
            'Nothing in {suit}, so I will just leave this here.',
            'I cannot follow {suit}. Take the trick, it is yours.',
            'Out of {suit} again. How embarrassing for me.',
            'No {suit} on this side. Enjoy the trick.',
            'That is a discard, not a gift. Probably.',
            'Nothing useful. Here, have a card you did not want.',
            'I have to let this one go. {suit} is not mine tonight.',
            'Take it. I am busy pretending I have options.',
            'A discard, and a lesson in what I am not holding.'
        ],
        discardPlayer: [
            'A discard. So you are out of {suit}. Noted.',
            'No {suit}? I will remember that, friend.',
            'You had to let that go. Interesting.',
            'That is you with no {suit}, then. Good to know.',
            'A discard. The most honest card in the game.',
            'So {suit} is your empty pocket. Noted.',
            'You could not follow. I will be using that.',
            'A throw-away. The round just improved for me.',
            'No {suit} for you. I am filing that away.'
        ],
        streakPlayer: [
            '{n} in a row? Okay, I am officially worried.',
            'You are on {n}. I should concentrate.',
            'Okay, okay. {n} straight. You have my attention.',
            '{n} tricks in a row. I am going to have to start trying.',
            '{n} straight. Show-off.',
            'That is {n} for you and none for me. I dislike the pattern.',
            '{n} on the spin. Say something nice so I can feel better.',
            '{n} in a row. I am rewriting my plan.',
            'That is {n}. I would like the next one, please.',
            '{n} straight for you. I am not panicking. I am planning.'
        ],
        streakAnne: [
            '{n} in a row! Do not panic.',
            'That is {n}! I could get used to this.',
            '{n} tricks. This is going rather well for me. Suspiciously well.',
            'I would apologise for a run of {n}, but I would not mean it.',
            'Look at that. {n} straight.',
            '{n} for me. The evening is being kind.',
            'That is {n} on the trot. I may start smiling.',
            '{n} in a row. I am allowed to enjoy this, I think.',
            '{n} straight. I will not mention it. I will just think about it.',
            '{n} tricks with no reply. Come on, friend.'
        ],
        targetPlayer: [
            'Target reached. The score starts moving now.',
            'You hit your tricks. The rest is bonus territory.',
            'That is your target. Now every trick is a point.',
            'Target done. I was hoping you would not notice.',
            'Your {tricks} tricks are covered. Now you are playing for points.',
            'Target, and with cards to spare. Fine. Fine.',
            'There it is. Your tricks are safe, the score is open.',
            'You reached it. I am going to have to be sharper.',
            'Target met. Now do not get greedy.'
        ],
        targetAnne: [
            'I have my tricks. Everything after this is profit.',
            'Target reached! Now the fun part.',
            'That is the target. I can relax. Slightly.',
            'I needed those. I have them now.',
            'My {tricks} tricks are in the bag. Now the scoreboard.',
            'There is my target. I do hope you were watching.',
            'Target reached, and I am still holding good cards.',
            'That is the safety net done. Now the points.',
            'My tricks are safe. Yours are the problem.'
        ],
        playerScored: [
            'A point for you. I will watch the trump more closely.',
            'That round was yours. Well read, honestly.',
            'You found the extra trick. Nicely done.',
            'One to you. I am not going to pretend I am happy.',
            'You earned that point. I still have opinions.',
            'That point is yours. The table feels different now.',
            'You hit your target and took the point. Efficient.',
            'One for you. I will be quieter about my leads.',
            'Right. That one is yours. The next deal is mine.'
        ],
        anneScored: [
            'That round is mine! The target is not a suggestion.',
            'I held the right cards at the right time. Another round?',
            'One to me. I will try not to make a habit of it.',
            'Point taken. And kept.',
            'That is mine. I did warn you.',
            'One for me. I counted every card, you know.',
            'My round. I am being gracious about it. Mostly.',
            'That point is mine, and the evening just got interesting.',
            'Mine. Try not to think about it too much.'
        ],
        comeback: [
            'You were behind and now look at you. Levelled. Well played.',
            'From behind to level? You have been paying attention.',
            'I had a lead a moment ago. I would like it back.',
            'Level again. You are making me work for this evening.',
            'That is a comeback. I am impressed and slightly annoyed.',
            'All square. I have made this harder for myself.',
            'You caught me. The table noticed. So did I.',
            'Levelled. I do not like the direction of travel.'
        ],
        ahead: [
            '{p}–{c}. You are pulling away. I do not like it.',
            'Two clear now. I am going to need something special.',
            'You are ahead, and I am out of excuses.',
            '{p} to {c}. Do not get comfortable.',
            'That is a lead worth having. For you, unfortunately.',
            '{p}–{c}. I am still here, in case you were wondering.',
            'You are clear by more than one. I noticed.',
            '{p}–{c}. Careful, I play better when I am annoyed.'
        ],
        behind: [
            '{c}–{p} to me. I would say I am sorry, but I would be lying.',
            'You are chasing now. I have been chased before.',
            'I am ahead, and I intend to stay here.',
            'That is a gap. Not a big one. Yet.',
            'I have the lead. Try to take it back.',
            '{c}–{p}. I am not gloating. Out loud.',
            'The gap suits me. I will keep it, thank you.',
            '{c}–{p}, and I am starting to enjoy the evening.'
        ],
        closeGame: [
            'One point between us, and both of us can feel it.',
            'This is the part of the evening I enjoy most.',
            'So it comes down to this, does it?',
            'One point apart. My hands are not shaking. Much.',
            'Level, late, and no room for mistakes. Lovely.',
            'Close enough that one trick decides the mood.',
            'One point each way, and the cards still deciding.',
            'Tight as a drum. Someone has to blink.'
        ],
        firstTrick: [
            'First blood is on the table.',
            'Here we go, then.',
            'One down. Fourteen to go.',
            'First trick of the round. Everyone looks confident. Nobody is.',
            'That sets the tone. The table has a pulse now.',
            'First one in. Let us see who blinks.',
            'And we are open. The trumps are the interesting part.',
            'Fourteen more of these. Plenty of time to be clever.',
            'Off we go. I am already counting.',
            'The round starts quietly. It never stays quiet.'
        ],
        lastTricks: [
            'Two tricks left in this round. Time to count properly.',
            'Two to play, and I have stopped being polite about it.',
            'Two left. This is where rounds are won.',
            'The round is nearly done. The loudest part is coming.',
            'Two tricks. Everything before this was just talking.',
            'Two to go. My target is either safe or it is not.',
            'Two tricks left and the whole round is still listening.',
            'Nearly there. I will be counting out loud now.'
        ],
        finalTrick: [
            'One trick left. No more cards to hide behind.',
            'Last trick. Whatever happens, happens now.',
            'This is the final one. I hope you are counting too.',
            'One card each. This decides the mood of the round.',
            'Last trick of the deal. Deep breath.',
            'One more and we can both stop holding our breath.',
            'The last card. I have been thinking about this one.'
        ],
        blankRound: [
            'A blank round! The scoreboard is sulking.',
            'No points either way. We are both better than that.',
            'Nobody scored. How diplomatic of us.',
            'Nothing for either of us. I will pretend that was the plan.',
            'A dead round. We both tried and both missed. Charming.',
            'No winner, no points. The deal had a sense of humour.',
            'Nobody scored. I am telling myself that is a draw, not a failure.'
        ],
        playerMatchPoint: [
            'One point from the match! No pressure at all.',
            'Match point to you. I am not done yet, friend.',
            'You are one away. I would like that to stop.',
            'One point. That is all you need. That is all I can think about.',
            'So close. Try not to think about it.',
            'You are one point from the table. I am one point from trouble.',
            'Match point against me. I hate the arithmetic.',
            'One point and the evening is yours. I have other ideas.',
            'You can smell it, can you not? So can I.'
        ],
        anneMatchPoint: [
            'Match point to me! I intend to use it.',
            'One point from the table. You will need a strong reply.',
            'I am one away. Serve, as they say.',
            'One point. I am going to be unbearable if I get it.',
            'Match point to me. Sorry in advance.',
            'I am one point from winning, and I will not pretend otherwise.',
            'One more point. I can already taste it.',
            'Match point. I have been here before. It worked out.',
            'The end is one point away. Let us have it, shall we?'
        ],
        matchWin: [
            'You took the table! That was a match worth playing.',
            'You earned every point. Rematch? I will deal.',
            'Fair and square. I will be thinking about that one.',
            'The table is yours. Do not let it go to your head.',
            'You win, and you won it properly. I will be better next time.',
            'Every point counted and you still got there. Enjoy it.',
            'Beaten. I will remember the deal that decided it.',
            'You take the evening. I will take the rematch, if you dare.'
        ],
        matchLoss: [
            'The table is mine this time! You made me work for it.',
            'A good match, friend. I will deal the next one.',
            'I win. I am gracious about it. Mostly.',
            'Close one. Another? I have plenty of cards.',
            'Mine, at last. You made it expensive.',
            'I win the evening. Shall I shuffle again?',
            'You fell short by one. I feel that in my shoulders.',
            'The table stays mine. Come back and try again.'
        ],
        invalid: [
            'Follow suit, please. {suit} is on the table.',
            'Not that one. You still have a {suit}.',
            'Rule one: if you can follow {suit}, you must.',
            'You have got a {suit} in there. Use it.',
            'That is not your card to play. {suit}, remember.',
            'Careful. {suit} is the suit you have to follow.',
            'The lead is {suit}. That card is not it.',
            'Nice try. The rules say {suit}.'
        ],
        powerPlayer: [
            '{rank} of {suit}! You came to play.',
            'Not the {rank} of {suit}. Fine, I deserved that.',
            'That {rank} is going to be trouble, I can feel it.',
            'The {rank} of {suit}. Shoulders back, then.',
            'You played the {rank}. Bold, with cards still to come.',
            'Ah, the {rank}. I hoped you would waste it. You did not.',
            'The {rank} of {suit} hits the felt. Noted.',
            'That is a {rank}. I will have to respect you now.'
        ],
        idle: [
            'Take your time. The good cards are not going anywhere.',
            'I can see your face, you know. Some of it.',
            'Any time you like. I am comfortable.',
            'If you are counting, I am counting harder.',
            'You are thinking. That is either good or very bad for me.',
            'I have had easier opponents. I have had worse company.',
            'The table is quiet. I do not trust quiet.',
            'Whenever you are ready. I will be here. Smiling.',
            'Counting your trumps? I have already counted mine.',
            'A long think. I hope it is worth it.',
            'I can wait. I have cards and a whole evening.',
            'Say something. Or play something. Either is fine.'
        ],
        thinking: [
            'Let me think about this one...',
            'Hm. Interesting position.',
            'Give me a second, I am scheming.',
            'Now this is a decision.',
            'Careful now, Anne.',
            'Two options, and one of them is wrong.',
            'Let me count this properly...',
            'Mm. I did not plan for that card.'
        ],
        tutorial: [
            'I will show you the first decision. No score attached.',
            'This is the part that decides most rounds.'
        ],
        // Callbacks. These only fire on the second, fourth... time a thing
        // happens in the same match, so Anne is remembering the evening rather
        // than narrating it. A line that says "again" has to have a first one.
        ruffPlayerAgain: [
            'Ruffing me again. Twice now. I am starting to take it personally.',
            'That is the second time you have gone behind my back with a trump.',
            'Another ruff. You have found my weak suit twice. Well done, annoyingly.',
            'Twice you have been void and made me pay. I am writing this down.',
            'A ruff again. I may stop leading that suit altogether.',
            'Second ruff. You are collecting my bad news.'
        ],
        ruffAnneAgain: [
            'Second ruff for me. I did warn you about my trumps.',
            'I have done that twice now. Are you watching my discards at all?',
            'Ruff again. You keep leaving that door open, friend.',
            'That is twice. I am not even sorry any more.',
            'Another trump from nowhere. I did say to watch them.',
            'My second ruff. The table is getting expensive for you.'
        ],
        readVoid: [
            'No {suit} that time either. That is twice you have been void. Noted.',
            'Out of {suit} again? I have a memory, you know.',
            'Second time with no {suit}. I am going to use that.',
            'You keep running out of {suit}. I keep noticing.',
            'Twice with no {suit}. That is a pattern, friend.',
            '{suit} led, no {suit} from you. I am keeping score of that as well.'
        ],
        anneReadVoid: [
            'No {suit} for me either. Twice now. You are paying attention.',
            'That is the second {suit} I could not follow. You are reading me.',
            'Twice out of {suit}. Hm. You are better at this than I said.',
            'You found my void again. I dislike how well that worked.',
            'My second {suit} void. You are not guessing, are you?',
            'You played straight at my weak suit twice. Efficient and rude.'
        ],
        rematchWelcome: [
            'Back for more? Good. I have been thinking about that last match.',
            'You came back. I would have too, in your position.',
            'Another match, then. Same table, no mercy.',
            'I remember how the last one went. So do you, I expect.',
            'Good, you are back. The cards have been waiting.',
            'Same chairs, same deck, and I am still counting.'
        ],
        // Remembering who won the last match is what makes the second evening
        // feel like a second evening rather than a first one.
        rematchWelcomeWon: [
            'Back again, and holding the last match over me. Brave.',
            'You took the last one. I have been thinking about it all day.',
            'A rematch. I owe you one, and I dislike owing.',
            'You beat me last time. I have corrected that in my head. Let us see.',
            'The table remembers who won. So do I.',
            'Back for a second helping? I have other plans this time.'
        ],
        rematchWelcomeLost: [
            'Back for another? Good. That is the spirit.',
            'You lost the last one and came back anyway. I like that.',
            'Another go? I will try not to enjoy it quite as much.',
            'You want the table back. I understand. You cannot have it.',
            'A rematch. I kept the cards warm for you.',
            'You are back. I was starting to miss winning.'
        ]
    };


    const MOODS = {
        neutral: { label: 'Watching', hold: 3400 },
        happy: { label: 'Pleased', hold: 3400 },
        tease: { label: 'Pleased with herself', hold: 3600 },
        impressed: { label: 'Impressed', hold: 3800 },
        thinking: { label: 'Thinking', hold: 0 },
        focused: { label: 'Focused', hold: 3400 },
        sorry: { label: 'Sympathetic', hold: 3400 }
    };

    const CHARACTERS = {
        anne: {
            id: 'anne',
            name: 'Anne',
            role: 'The card-table host',
            profile: 'Confident, warm and competitive. She plays the cards she is dealt.'
        }
    };

    const registry = new Map(Object.entries(CHARACTERS));
    const slots = ['anne', null, null]; // room for the 3-2-5 and Coat & Shuffle hosts
    let reactionTimer = null;
    let speechToken = 0;
    let lastSaidAt = 0;
    let lastMood = 'neutral';
    let lastKey = '';
    let lastScores = null;
    let lastTricks = { player: 0, computer: 0 };
    let lastMatchOpen = false;
    let welcomed = false;
    let lastDealRound = 0;
    let matchesPlayed = 0;
    // What Anne remembers about this match. Reset with the match, never with a
    // round: the point of a callback is that it spans deals.
    let memory = null;
    // EOL PROBE
    function resetMemory() {
        memory = {
            playerRuffs: 0, anneRuffs: 0,
            playerVoid: Object.create(null), anneVoid: Object.create(null),
            // The trick-target line is announced once per deal. A side sits on
            // its target for the rest of the round, so announcing on the
            // condition alone made her repeat herself every other trick.
            playerTargetSaid: false, anneTargetSaid: false
        };
    }

    // Who won the last match. This deliberately survives resetMemory(): the
    // greeting of a rematch should remember the match that just ended.
    let previousMatchWinner = null;

    // ---------------------------------------------------------------- dialogue
    // A bag per category. Every line is used before any of them repeats.
    const bags = Object.create(null);
    const recentLines = [];

    function shuffledIndexes(n) {
        const list = Array.from({ length: n }, (_, i) => i);
        for (let i = list.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [list[i], list[j]] = [list[j], list[i]];
        }
        return list;
    }

    function format(template, vars) {
        return String(template).replace(/\{(\w+)\}/g, (_, name) => (vars && vars[name] != null ? vars[name] : ''));
    }

    function draw(key, vars) {
        const list = LINES[key] || LINES.welcome;
        let bag = bags[key];
        const fresh = !bag || !bag.length;
        if (fresh) {
            bag = shuffledIndexes(list.length);
            bags[key] = bag;
            // Do not open a fresh bag with the line that is still on screen.
            const next = format(list[bag[bag.length - 1]], vars);
            if (list.length > 1 && next === recentLines[recentLines.length - 1]) {
                bag.unshift(bag.pop());
            }
        }
        let text = '';
        // The bag already prevents repeats inside a category; this also avoids
        // echoing a line still fresh from another category.
        for (let attempt = 0; attempt < 4; attempt++) {
            if (!bag.length) { bag = shuffledIndexes(list.length); bags[key] = bag; }
            text = format(list[bag.pop()], vars);
            if (!recentLines.includes(text)) break;
        }
        recentLines.push(text);
        if (recentLines.length > 14) recentLines.shift();
        return text;
    }

    function current() {
        return registry.get('anne');
    }

    function line(key, vars) {
        return draw(key, vars);
    }

    function seat() {
        return document.querySelector('.computer-area');
    }

    function setMood(mood) {
        const node = seat();
        if (!node) return;
        node.dataset.mood = mood;
        const chip = $('anne-mood');
        if (chip) chip.textContent = (MOODS[mood] || MOODS.neutral).label;
        if (window.TableAvatar) {
            // Only the warm moods get a body beat; a bob on every line reads as
            // a twitch rather than a reaction.
            const beat = mood === 'happy' || mood === 'impressed' || mood === 'tease' || mood === 'sorry';
            window.TableAvatar.mood(mood, { beat });
        }
    }

    // The line appears a character at a time, like someone typing. The full
    // text is in the DOM from the start, so a screen reader (or a test) reads
    // the whole sentence immediately.
    function typeOut(bubble, text) {
        const reduced = window.TableSettings ? window.TableSettings.get().motion === 'reduced' : false;
        if (reduced || typeof bubble.replaceChildren !== 'function') {
            bubble.textContent = text;
            return;
        }
        const frag = document.createDocumentFragment();
        Array.from(text).forEach((ch) => {
            const span = document.createElement('span');
            span.className = 'aa-char';
            span.textContent = ch;
            frag.appendChild(span);
        });
        bubble.replaceChildren(frag);
        const spans = bubble.querySelectorAll('.aa-char');
        spans.forEach((span, i) => {
            span.style.transitionDelay = `${Math.min(420, i * 10)}ms`;
        });
        requestAnimationFrame(() => {
            spans.forEach((span) => span.classList.add('is-in'));
        });
    }

    // The portrait ring follows the actual utterance when the browser voice is
    // on. If synthesis is unavailable, the visual hold remains the clock. A
    // token stops a cancelled line's late onend from muting the next one.
    function talkWithVoice(text, mood, duration) {
        const token = ++speechToken;
        let started = false;
        const startRing = () => {
            if (token !== speechToken || started) return;
            started = true;
            if (window.TableAvatar) window.TableAvatar.speak(text, 12000);
        };
        const endRing = () => {
            if (token !== speechToken) return;
            if (window.TableAvatar) window.TableAvatar.quiet();
        };
        let spoken = false;
        if (window.AnneVoice) {
            spoken = window.AnneVoice.speak(text, mood, { onstart: startRing, onend: endRing });
        }
        if (!spoken) {
            if (window.TableAvatar) window.TableAvatar.speak(text, duration);
            return;
        }
        // A blocked or slow utterance can leave onstart silent. The line is
        // already on screen, so do not leave the portrait still indefinitely.
        setTimeout(() => { if (token === speechToken && !started) startRing(); }, 650);
    }

    function stopVoice() {
        speechToken += 1;
        if (window.AnneVoice) window.AnneVoice.stop();
        if (window.TableAvatar) window.TableAvatar.quiet();
    }

    function speak(key, mood, hold, vars) {
        const bubble = $('anne-reaction');
        if (!bubble) return;
        const text = line(key, vars);
        lastMood = mood || 'neutral';
        setMood(mood || 'neutral');
        if (reactionTimer) clearTimeout(reactionTimer);
        bubble.hidden = false;
        bubble.classList.add('is-visible');
        typeOut(bubble, text);
        const node = seat();
        if (node) {
            node.classList.remove('is-speaking');
            void node.offsetWidth;
            node.classList.add('is-speaking');
        }
        const moodInfo = MOODS[mood] || MOODS.neutral;
        const duration = hold || moodInfo.hold || 3400;
        talkWithVoice(text, mood || 'neutral', duration);
        lastSaidAt = Date.now();
        lastKey = key;
        reactionTimer = setTimeout(() => {
            bubble.classList.remove('is-visible');
            reactionTimer = setTimeout(() => {
                bubble.hidden = true;
                reactionTimer = null;
                if (node) node.classList.remove('is-speaking');
                if (window.TableAvatar) window.TableAvatar.quiet();
                if (seat() && seat().dataset.mood !== 'thinking') setMood('neutral');
            }, 260);
        }, duration);
    }

    // Public, also used by the tutorial and coach.
    function showReaction(text, hold) {
        const bubble = $('anne-reaction');
        if (!bubble) return;
        if (reactionTimer) clearTimeout(reactionTimer);
        bubble.hidden = false;
        bubble.classList.add('is-visible');
        typeOut(bubble, text);
        setMood('focused');
        talkWithVoice(text, 'focused', hold || 4200);
        lastSaidAt = Date.now();
        reactionTimer = setTimeout(() => {
            bubble.classList.remove('is-visible');
            reactionTimer = setTimeout(() => {
                bubble.hidden = true;
                reactionTimer = null;
                if (window.TableAvatar) window.TableAvatar.quiet();
                setMood('neutral');
            }, 260);
        }, hold || 4200);
    }

    function updateDifficulty() {
        const value = window.TableSettings ? window.TableSettings.get().difficulty : 'medium';
        const label = value.charAt(0).toUpperCase() + value.slice(1);
        const badge = $('anne-difficulty');
        if (badge) badge.textContent = label;
        const node = seat();
        if (node) node.setAttribute('aria-label', `Anne, playing at ${label} difficulty`);
    }

    function matchResult(winner) {
        const won = winner === 'Player';
        previousMatchWinner = winner;
        const portrait = $('anne-result-avatar');
        if (portrait && window.TableAvatar) window.TableAvatar.mount(portrait, { crop: 'bust' });
        const text = $('anne-result-line');
        if (text) text.textContent = line(won ? 'matchWin' : 'matchLoss');
        const bubble = $('anne-reaction');
        if (bubble) { bubble.hidden = true; bubble.classList.remove('is-visible'); }
        if (reactionTimer) clearTimeout(reactionTimer);
        stopVoice();
        lastMatchOpen = true;
        setMood(won ? 'impressed' : 'tease');
        return won ? 'matchWin' : 'matchLoss';
    }

    function resetMatch() {
        lastMatchOpen = false;
        lastScores = null;
        lastTricks = { player: 0, computer: 0 };
        welcomed = false;
        lastDealRound = 0;
        lastSaidAt = 0;
        lastKey = '';
        lastMood = 'neutral';
        // The winner of the previous match is deliberately kept: it is what the
        // next greeting refers to.
        resetMemory();
        if (reactionTimer) clearTimeout(reactionTimer);
        const bubble = $('anne-reaction');
        if (bubble) { bubble.hidden = true; bubble.classList.remove('is-visible'); }
        stopVoice();
        if (window.TableAvatar) window.TableAvatar.reset();
        setMood('neutral');
    }

    function trickTarget(side) {
        if (typeof GameEngine === 'undefined' || !GameEngine.state.trumpSuit) return null;
        return GameEngine.getTrickTarget(side);
    }

    // How many tricks are still to come. Counting the cards rather than
    // assuming a fifteen-trick deal keeps the late-round lines honest.
    function tricksRemaining() {
        if (typeof GameEngine === 'undefined' || !GameEngine.state) return null;
        const gs = GameEngine.state;
        const left = (side) => {
            const data = gs[side];
            if (!data) return null;
            return data.hand.filter(Boolean).length + data.faceUp.filter(Boolean).length + data.faceDown.filter(Boolean).length;
        };
        const counts = [left('player'), left('computer')].filter((n) => n !== null);
        return counts.length ? Math.min(...counts) : null;
    }

    function cardParts(card) {
        const parts = String(card || '').split('_');
        return { rank: parts[0], suit: parts[1] };
    }

    // Everything a line might want to mention about the state of the evening.
    function context() {
        const gs = (typeof GameEngine !== 'undefined' && GameEngine.state) ? GameEngine.state : null;
        if (!gs) return { p: 0, c: 0, target: 5, round: 1, trump: 'the trump suit' };
        return {
            p: gs.player.score,
            c: gs.computer.score,
            target: gs.matchTarget || 5,
            round: gs.roundNumber,
            trump: SUIT[gs.trumpSuit] || 'the trump suit'
        };
    }

    // Every trick has a story: who was void, who ruffed, who stole it with a
    // small card. Anne comments on the story, not just the score, which is what
    // makes her feel like a person across the table instead of a tally.
    function onTrick(p) {
        if (!p || lastMatchOpen) return;
        // A restored table or a direct render can reach a target before the
        // first trick callback has had a chance to initialise this. Keep the
        // target bookkeeping safe even on that first callback.
        if (!memory) resetMemory();
        const playerTarget = trickTarget('player');
        const anneTarget = trickTarget('computer');
        if (anneTarget && p.computerTricks >= anneTarget && !memory.anneTargetSaid) {
            memory.anneTargetSaid = true;
            speak('targetAnne', 'tease', 4600, { tricks: anneTarget });
            return;
        }
        if (playerTarget && p.playerTricks >= playerTarget && !memory.playerTargetSaid) {
            memory.playerTargetSaid = true;
            speak('targetPlayer', 'impressed', 4600, { tricks: playerTarget });
            return;
        }

        const lead = p.leadSuit;
        const trump = p.trumpSuit;
        const mine = cardParts(p.computerCard);
        const yours = cardParts(p.playerCard);
        const won = p.winner === 'computer';
        const now = Date.now();
        const special = won ? p.anneRuffed : p.playerRuffed;

        // Count what she has actually seen. A callback only fires on the second
        // (and fourth) occurrence, so it can never claim an "again" that never
        // happened.
        if (p.playerRuffed) memory.playerRuffs++;
        if (p.anneRuffed) memory.anneRuffs++;
        if (!won && yours.suit !== lead && yours.suit !== trump) {
            memory.playerVoid[lead] = (memory.playerVoid[lead] || 0) + 1;
        }
        if (won && mine.suit !== lead && mine.suit !== trump) {
            memory.anneVoid[lead] = (memory.anneVoid[lead] || 0) + 1;
        }

        if (now - lastSaidAt < 1600 && !special) return;

        if (p.anneRuffed && won) {
            if (memory.anneRuffs === 2 || memory.anneRuffs === 4) {
                speak('ruffAnneAgain', 'tease', 3800, { suit: SUIT[lead] || lead });
                return;
            }
            speak('ruffAnne', 'tease', 3600, { suit: SUIT[lead] || lead, trump: SUIT[trump] || 'trump' });
            return;
        }
        if (p.playerRuffed && !won) {
            if (memory.playerRuffs === 2 || memory.playerRuffs === 4) {
                speak('ruffPlayerAgain', 'impressed', 4000);
                return;
            }
            speak('ruffPlayer', 'impressed', 3600);
            return;
        }
        if (!won && yours.suit !== lead && yours.suit !== trump) {
            // Only the second time: the first discard already got its own line,
            // so "again" is earned by something she actually saw before.
            if (memory.playerVoid[lead] === 2) {
                speak('readVoid', 'tease', 3800, { suit: SUIT[lead] || lead });
            } else {
                speak('discardPlayer', 'tease', 3200, { suit: SUIT[lead] || lead });
            }
            return;
        }
        if (won && mine.suit !== lead && mine.suit !== trump) {
            if (memory.anneVoid[lead] === 2) {
                speak('anneReadVoid', 'sorry', 3800, { suit: SUIT[lead] || lead });
            } else {
                speak('discardAnne', 'sorry', 3200, { suit: SUIT[lead] || lead });
            }
            return;
        }

        // The shape of the round itself: an opener, and the two-trick warning.
        if (p.trickNumber === 1) {
            speak('firstTrick', won ? 'tease' : 'happy', 3200);
            return;
        }
        // "Two tricks left" only when two are actually left; the last trick
        // gets its own line instead of being folded into the same one.
        const remains = tricksRemaining();
        if (remains === 2) {
            speak('lastTricks', 'focused', 3600);
            return;
        }
        if (remains === 1) {
            speak('finalTrick', 'focused', 3600);
            return;
        }

        // A run of three is worth noticing; a run of six is not "three in a
        // row". The line is told the real number so it is never a lie, and a
        // long run only speaks up while the other side has nothing at all, so
        // the same joke does not land twice in one deal.
        const streak = won ? p.computerTricks : p.playerTricks;
        const reply = won ? p.playerTricks : p.computerTricks;
        if (streak === 3 || (streak >= 5 && reply === 0)) {
            speak(won ? 'streakAnne' : 'streakPlayer', won ? 'tease' : 'impressed', 3800, { n: streak });
            return;
        }
        // Not every trick needs a sentence; a host who narrates all fifteen is
        // noise. Leave the quiet ones quiet so the special ones land.
        if (p.trickNumber % 4 === 0) return;
        speak(won ? 'trickAnne' : 'trickPlayer', won ? 'tease' : 'happy', 3200);
    }

    function onRound(p) {
        if (!p || lastMatchOpen) return;
        const before = lastScores ? lastScores.split(':').map(Number) : [0, 0];
        const after = [Number(p.playerScore) || 0, Number(p.computerScore) || 0];
        const margins = after[0] - after[1];
        const vars = context();

        if (p.playerRoundScore > 0 && p.computerRoundScore <= 0) {
            if (margins >= 2) { speak('ahead', 'focused', 4400, vars); return; }
            if (before[0] <= before[1]) { speak('comeback', 'impressed', 4400); return; }
            speak('playerScored', 'impressed', 4200);
            return;
        }
        if (p.computerRoundScore > 0 && p.playerRoundScore <= 0) {
            if (margins >= 2) { speak('behind', 'tease', 4400, vars); return; }
            speak('anneScored', 'tease', 4200);
            return;
        }
        if (p.playerRoundScore > 0 && p.computerRoundScore > 0) {
            speak(p.playerRoundScore > p.computerRoundScore ? 'playerScored' : 'anneScored',
                p.playerRoundScore > p.computerRoundScore ? 'impressed' : 'tease', 4200);
            return;
        }
        speak('blankRound', 'focused', 3800);
    }

    function onInvalid(p) {
        const suit = p && p.leadSuit ? SUIT[p.leadSuit] : 'the lead suit';
        const symbol = p && p.leadSuit ? ` ${SYMBOL[p.leadSuit]}` : '';
        speak('invalid', 'sorry', 3600, { suit: suit + symbol });
    }

    function onDeal(p) {
        const round = (p && p.roundNumber) || 0;
        if (!round || round === lastDealRound) return;
        lastDealRound = round;
        // A new deal resets the once-per-deal announcements, not the match
        // memory: the callbacks are meant to span deals.
        if (memory) {
            memory.playerTargetSaid = false;
            memory.anneTargetSaid = false;
        }
        // Round one already gets a welcome once play starts; every later deal
        // is the natural moment to say where the match stands.
        if (round > 1) speak('roundStart', 'neutral', 3600, context());
    }

    function sync() {
        if (typeof GameEngine === 'undefined' || !GameEngine.state) return;
        const gs = GameEngine.state;
        updateDifficulty();

        if (!gs.gameStarted || gs.gameOver) {
            if (gs.gameOver) lastMatchOpen = true;
            return;
        }
        if (lastMatchOpen) resetMatch();
        if (!welcomed && gs.gamePhase === 'playing') {
            welcomed = true;
            matchesPlayed++;
            if (matchesPlayed === 1) {
                speak('welcome', 'happy', 4400, context());
            } else if (previousMatchWinner === 'Player') {
                speak('rematchWelcomeWon', 'focused', 4400, context());
            } else if (previousMatchWinner === 'Computer') {
                speak('rematchWelcomeLost', 'happy', 4400, context());
            } else {
                speak('rematchWelcome', 'happy', 4400, context());
            }
        }

        const score = `${gs.player.score}:${gs.computer.score}`;
        const scoreChanged = lastScores !== null && score !== lastScores;
        if (scoreChanged) {
            const before = lastScores.split(':').map(Number);
            const pGain = gs.player.score - before[0];
            const cGain = gs.computer.score - before[1];
            if (pGain > 0 || cGain > 0) {
                const target = gs.matchTarget || 5;
                // Only the arrival at one-from-the-match, not every later point.
                const arriving = (gs.player.score === target - 1 && before[0] < target - 1)
                    || (gs.computer.score === target - 1 && before[1] < target - 1);
                if (arriving && window.GameAudio) window.GameAudio.play('matchPoint');
                const gap = Math.abs(gs.player.score - gs.computer.score);
                if (gap === 1 && Math.max(gs.player.score, gs.computer.score) >= target - 2 && !arriving) {
                    speak('closeGame', 'focused', 4200);
                } else if (gs.player.score >= target - 1 || gs.computer.score >= target - 1) {
                    speak(pGain > 0 ? 'playerMatchPoint' : 'anneMatchPoint', pGain > 0 ? 'focused' : 'tease', 5000);
                }
            }
        }
        lastScores = score;

        // A safety net for paths that do not emit a trick event (a re-render
        // after a restored state, or a test that sets the count directly).
        // The live trick event normally gets here first; do not repeat its line.
        if (!scoreChanged && lastKey !== 'targetAnne' && lastKey !== 'targetPlayer' && memory) {
            const targets = { player: trickTarget('player'), computer: trickTarget('computer') };
            for (const side of ['player', 'computer']) {
                const flag = side === 'player' ? 'playerTargetSaid' : 'anneTargetSaid';
                if (targets[side] && gs[side].tricksWon >= targets[side] && !memory[flag]) {
                    memory[flag] = true;
                    speak(side === 'player' ? 'targetPlayer' : 'targetAnne', side === 'player' ? 'impressed' : 'tease', 4600, { tricks: targets[side] });
                    break;
                }
            }
        }
        lastTricks = { player: gs.player.tricksWon, computer: gs.computer.tricksWon };
    }

    function init() {
        updateDifficulty();
        document.addEventListener('tablesettings:change', updateDifficulty);
        document.addEventListener('gameview:render', sync);
        document.addEventListener('gameview:reset', resetMatch);
        document.addEventListener('gameview:event', (ev) => {
            const detail = ev.detail || {};
            const p = detail.payload || {};
            switch (detail.name) {
                case 'thinking':
                    if (p.show) {
                        setMood('thinking');
                        if (Date.now() - lastSaidAt > 7000) speak('thinking', 'thinking', 1800);
                    } else if (seat() && seat().dataset.mood === 'thinking') {
                        const bubble = $('anne-reaction');
                        setMood(bubble && !bubble.hidden && lastMood !== 'thinking' ? lastMood : 'neutral');
                    }
                    break;
                case 'coin':
                    speak(p.playerWins ? 'coinPlayer' : 'coinAnne', p.playerWins ? 'happy' : 'tease', 3400);
                    break;
                case 'trump':
                    speak(p.selector === 'computer' ? 'trumpAnne' : 'trumpPlayer',
                        p.selector === 'computer' ? 'tease' : 'impressed', 3800,
                        { suit: SUIT[p.suit] || p.suit, symbol: SYMBOL[p.suit] || '' });
                    break;
                case 'trick': onTrick(p); break;
                case 'play': {
                    // React to the card that actually landed, not only to who
                    // won the trick. It is the difference between a card table
                    // and a scoreboard.
                    if (p.side === 'player' && p.card) {
                        const [rank, suit] = String(p.card).split('_');
                        // Only if she is not already mid-line: no talking over
                        // herself, and no dependence on wall-clock time.
                        if ((rank === 'A' || rank === 'K') && !reactionTimer) {
                            speak('powerPlayer', 'impressed', 2600, {
                                rank: rank === 'A' ? 'Ace' : 'King',
                                suit: SUIT[suit] || suit
                            });
                        }
                    }
                    break;
                }
                case 'invalid': onInvalid(p); break;
                case 'round': onRound(p); break;
                case 'deal': onDeal(p); break;
                case 'match': matchResult(p.winner); break;
                default: break;
            }
        });
        // A quiet ticker so she is still there when the player stops to think.
        // It starts on the first real gesture (never in a scripted test run) and
        // stays silent while she is mid-line, so she cannot talk over herself.
        const startIdleTicker = () => setInterval(() => {
            if (typeof GameEngine === 'undefined' || !GameEngine.state) return;
            const gs = GameEngine.state;
            if (lastMatchOpen || !gs.gameStarted || gs.gameOver || gs.gamePhase !== 'playing') return;
            if (gs.currentPlayer !== 'player' || gs.resolvingTrick) return;
            const bubble = $('anne-reaction');
            if (bubble && !bubble.hidden) return;
            if (Date.now() - lastSaidAt < 11000) return;
            speak('idle', 'neutral', 2800, context());
        }, 2500);
        ['pointerdown', 'keydown'].forEach((name) => {
            document.addEventListener(name, startIdleTicker, { once: true, passive: true });
        });

        const profile = current();
        const host = $('anne-portrait');
        if (host && window.TableAvatar) {
            window.TableAvatar.mount(host);
            host.setAttribute('aria-label', `${profile.name}, ${profile.role}`);
        }
        const intro = $('anne-seat-role');
        if (intro) intro.textContent = profile.role;
        setMood('neutral');
        sync();
    }

    window.TableCharacters = {
        current,
        get: (id) => registry.get(id) || null,
        line,
        showReaction,
        matchResult,
        resetMatch,
        setMood,
        slots: () => slots.slice()
    };

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
