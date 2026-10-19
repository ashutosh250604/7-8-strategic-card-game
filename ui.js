/*
 * ui.js - page chrome and input wiring: header, settings, rules/log modals,
 * Start / New Round / Restart buttons. No game rules live here; everything that
 * changes the game goes through GameEngine, everything that changes pixels in
 * the game flow goes through GameView.
 */
function initializeUI() {
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
            GameEngine.setDifficulty(difficulty);

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
        clearLogBtn.onclick = () => GameView.clearLog();
    }

    // Start game button
    const startGameBtn = document.getElementById('start-game');
    if (startGameBtn) {
        startGameBtn.onclick = () => GameEngine.startGame();
    }

    // New round button
    const newRoundBtn = document.getElementById('new-round');
    if (newRoundBtn) {
        newRoundBtn.onclick = () => GameEngine.startNewRound();
    }

    // Restart game button
    const restartBtn = document.getElementById('restart-game');
    if (restartBtn) {
        restartBtn.onclick = () => GameEngine.restartGame();
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
        selectTrumpBtn.onclick = () => GameEngine.reopenTrumpSelection();
    }

    // Close modals when clicking outside (with special handling for trump modal and coin toss)
    document.addEventListener('click', (e) => {
        if (e.target.classList.contains('modal')) {
            // Don't close coin toss modal by clicking outside - it can't be reopened
            if (e.target.id === 'coin-toss-modal') {
                return;
            }
            // Close these modals when clicking outside
            if (e.target.id === 'game-log-modal' || e.target.id === 'rules-modal' || e.target.id === 'settings-modal') {
                e.target.style.display = 'none';
                return;
            }
            e.target.style.display = 'none';
            // If trump modal was closed and trump not selected, show select trump button
            if (e.target.id === 'trump-selection-modal' && GameEngine.state.trumpSuit === null) {
                GameEngine.updateSelectTrumpButtonVisibility();
            }
        }
    });

    GameEngine.ready();
}

// Start the game when page loads
document.addEventListener('DOMContentLoaded', initializeUI);
