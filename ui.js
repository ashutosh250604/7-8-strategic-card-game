/*
 * ui.js - page chrome and input wiring: header, settings, rules/log modals,
 * Start / New Round / Restart buttons. No game rules live here; everything that
 * changes the game goes through GameEngine, everything that changes pixels in
 * the game flow goes through GameView.
 */
function initializeUI() {
    const $ = (id) => document.getElementById(id);
    const isOpen = (el) => !!el && getComputedStyle(el).display !== 'none';

    const settingsBtn = $('settings-btn');
    const settingsBtnMobile = $('settings-btn-mobile');
    const closeSettingsBtn = $('close-settings');
    const settingsModal = $('settings-modal');
    const rulesModal = $('rules-modal');
    const logModal = $('game-log-modal');
    const trumpModal = $('trump-selection-modal');

    let settingsReturnFocus = null;
    let rulesOrigin = null;

    const focusSoon = (el) => {
        if (!el) return;
        setTimeout(() => { try { el.focus({ preventScroll: true }); } catch (e) { /* detached */ } }, 50);
    };

    function openSettings() {
        if (!settingsModal) return;
        settingsReturnFocus = document.activeElement;
        settingsModal.style.display = 'flex';
        focusSoon(settingsModal.querySelector('.difficulty-btn.active') || closeSettingsBtn);
    }

    function closeSettings() {
        if (!settingsModal) return;
        settingsModal.style.display = 'none';
        if (settingsReturnFocus && settingsReturnFocus.isConnected) {
            try { settingsReturnFocus.focus({ preventScroll: true }); } catch (e) { /* detached */ }
        }
        settingsReturnFocus = null;
    }

    function openRules(origin) {
        if (!rulesModal) return;
        rulesOrigin = origin || document.activeElement;
        if (settingsModal) settingsModal.style.display = 'none';
        rulesModal.style.display = 'flex';
        focusSoon(rulesModal.querySelector('.close-modal'));
    }

    function closeRules() {
        if (!rulesModal) return;
        rulesModal.style.display = 'none';
        // Opened from settings: step back to settings. Opened from the start
        // panel: return to the button that started it, not to an unrelated modal.
        if (rulesOrigin === $('settings-rules') && settingsModal) {
            settingsModal.style.display = 'flex';
            focusSoon($('settings-rules'));
        } else if (rulesOrigin && rulesOrigin.isConnected) {
            focusSoon(rulesOrigin);
        }
        rulesOrigin = null;
    }

    if (settingsBtn) settingsBtn.onclick = openSettings;
    if (settingsBtnMobile) settingsBtnMobile.onclick = openSettings;
    if (closeSettingsBtn) closeSettingsBtn.onclick = closeSettings;

    // Difficulty buttons
    const difficultyBtns = document.querySelectorAll('.difficulty-btn');
    const difficultyDesc = $('difficulty-desc');
    const difficultyDisplay = $('difficulty-display');

    const difficultyDescriptions = {
        easy: 'Relaxed AI that makes random choices. Great for learning!',
        medium: 'Balanced AI that analyzes visible cards.',
        hard: 'Expert AI that tracks all played cards and plays optimally!'
    };

    difficultyBtns.forEach(btn => {
        btn.onclick = () => {
            const difficulty = btn.dataset.difficulty;
            GameEngine.setDifficulty(difficulty);

            difficultyBtns.forEach(b => {
                const active = b === btn;
                b.classList.toggle('active', active);
                b.setAttribute('aria-pressed', active ? 'true' : 'false');
            });

            if (difficultyDesc) {
                difficultyDesc.textContent = difficultyDescriptions[difficulty];
            }
            if (difficultyDisplay) {
                difficultyDisplay.innerHTML = `<span>${difficulty.charAt(0).toUpperCase() + difficulty.slice(1)}</span>`;
            }
        };
    });

    // Settings action rows
    const settingsGameLog = $('settings-game-log');
    const settingsRules = $('settings-rules');

    if (settingsGameLog && logModal && settingsModal) {
        settingsGameLog.onclick = () => {
            settingsModal.style.display = 'none';
            logModal.style.display = 'flex';
            focusSoon(logModal.querySelector('.close-modal'));
        };
    }

    if (settingsRules) settingsRules.onclick = () => openRules(settingsRules);

    // Game Log close - step back to settings, which is where it is opened from.
    const closeLogBtn = $('close-log-modal');
    const clearLogBtn = $('clear-log');

    if (closeLogBtn && logModal) {
        closeLogBtn.onclick = () => {
            logModal.style.display = 'none';
            if (settingsModal) {
                settingsModal.style.display = 'flex';
                focusSoon($('settings-game-log'));
            }
        };
    }

    if (clearLogBtn) clearLogBtn.onclick = () => GameView.clearLog();

    // Start game button
    const startGameBtn = $('start-game');
    if (startGameBtn) startGameBtn.onclick = () => GameEngine.startGame();

    // New round button
    const newRoundBtn = $('new-round');
    if (newRoundBtn) newRoundBtn.onclick = () => {
        GameView.hideRoundSummary();
        GameEngine.startNewRound();
    };

    // Restart game button
    const restartBtn = $('restart-game');
    if (restartBtn) restartBtn.onclick = () => GameEngine.restartGame();

    // Game over modal buttons
    const playAgainBtn = $('play-again');
    const exitGameBtn = $('exit-game');

    if (playAgainBtn && restartBtn) playAgainBtn.onclick = () => restartBtn.click();

    if (exitGameBtn) {
        exitGameBtn.onclick = () => {
            if (confirm('Are you sure you want to exit the game?')) {
                window.close();
            }
        };
    }

    // Rules can be opened from settings or from the start hero.
    const startRulesBtn = $('start-rules');
    const showRulesBtn = $('show-rules');
    const closeRulesBtn = $('close-rules');

    if (startRulesBtn) startRulesBtn.onclick = () => openRules(startRulesBtn);
    if (showRulesBtn) showRulesBtn.onclick = () => openRules(showRulesBtn);
    if (closeRulesBtn) closeRulesBtn.onclick = closeRules;

    // Select Trump button (for when the sheet is dismissed without a choice)
    const selectTrumpBtn = $('select-trump-btn');
    if (selectTrumpBtn) selectTrumpBtn.onclick = () => GameEngine.reopenTrumpSelection();

    // Close modals when clicking outside
    document.addEventListener('click', (e) => {
        if (!e.target.classList.contains('modal')) return;
        // The coin toss cannot be reopened, so it must be answered.
        if (e.target.id === 'coin-toss-modal') return;
        if (e.target.id === 'game-log-modal') {
            logModal.style.display = 'none';
            if (settingsModal) settingsModal.style.display = 'flex';
            return;
        }
        if (e.target.id === 'settings-modal') { closeSettings(); return; }
        if (e.target.id === 'rules-modal') {
            rulesModal.style.display = 'none';
            if (rulesOrigin === $('settings-rules') && settingsModal) settingsModal.style.display = 'flex';
            rulesOrigin = null;
            return;
        }
        if (e.target.id === 'trump-selection-modal') {
            e.target.style.display = 'none';
            if (GameEngine.state.trumpSuit === null) GameEngine.updateSelectTrumpButtonVisibility();
            focusSoon(selectTrumpBtn);
            return;
        }
        e.target.style.display = 'none';
    });

    // Escape closes the dialog layer that can safely be reopened. The coin toss
    // and game-over dialogs stay put because the match cannot continue without them.
    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape') return;
        if (isOpen(settingsModal)) { closeSettings(); return; }
        if (isOpen(rulesModal)) { closeRules(); return; }
        if (isOpen(logModal) && logModal) {
            logModal.style.display = 'none';
            if (settingsModal) { settingsModal.style.display = 'flex'; focusSoon($('settings-game-log')); }
            return;
        }
        if (isOpen(trumpModal)) {
            trumpModal.style.display = 'none';
            GameEngine.updateSelectTrumpButtonVisibility();
            focusSoon(selectTrumpBtn);
        }
    });

    GameEngine.ready();
}

// Start the game when page loads
document.addEventListener('DOMContentLoaded', initializeUI);
