/*
 * ui.js - page chrome and input wiring: header, settings, rules/log modals,
 * start / new round / restart controls. No game rules live here. Everything that
 * changes the game goes through GameEngine; pixel changes go through GameView.
 */
function initializeUI() {
    const $ = (id) => document.getElementById(id);
    const isOpen = (el) => !!el && getComputedStyle(el).display !== 'none';
    const prefs = () => (window.TableSettings ? window.TableSettings.get() : null);

    const settingsBtn = $('settings-btn');
    const settingsBtnMobile = $('settings-btn-mobile');
    const muteBtn = $('mute-btn');
    const closeSettingsBtn = $('close-settings');
    const settingsModal = $('settings-modal');
    const rulesModal = $('rules-modal');
    const logModal = $('game-log-modal');
    const trumpModal = $('trump-selection-modal');
    const confirmModal = $('confirm-modal');
    const gameOverModal = $('game-over-modal');

    let settingsReturnFocus = null;
    let rulesOrigin = null;
    let confirmReturnFocus = null;

    const focusSoon = (el) => {
        if (!el) return;
        setTimeout(() => { try { el.focus({ preventScroll: true }); } catch (e) { /* detached */ } }, 60);
    };

    // -------------------------------------------------------------- settings UI
    const difficultyBtns = document.querySelectorAll('.difficulty-btn');
    const difficultyDesc = $('difficulty-desc');
    const difficultyDisplay = $('difficulty-display');
    const targetBtns = document.querySelectorAll('.target-btn');
    const targetNote = $('target-note');
    const soundBtn = $('settings-sound');
    const volumeInput = $('settings-volume');
    const volumeValue = $('volume-value');
    const hapticsBtn = $('settings-haptics');
    const hapticsNote = $('haptics-note');
    const motionBtns = document.querySelectorAll('.motion-btn');

    const difficultyDescriptions = {
        easy: 'Anne plays fast and loose. A good table for learning the shape of a round.',
        medium: 'Anne plays a balanced game and watches your visible cards.',
        hard: 'Anne counts the cards she has seen and plans the unseen hands.'
    };

    function setPressed(buttons, activeValue, key) {
        buttons.forEach((btn) => {
            const active = btn.dataset[key] === String(activeValue);
            btn.classList.toggle('active', active);
            btn.setAttribute('aria-pressed', active ? 'true' : 'false');
        });
    }

    function targetNoteText(value) {
        const gs = typeof GameEngine !== 'undefined' ? GameEngine.state : null;
        if (gs && gs.gameStarted && !gs.gameOver) {
            return value === gs.matchTarget
                ? `This match is first to ${gs.matchTarget}.`
                : `Applies next match. This match is still first to ${gs.matchTarget}.`;
        }
        return `Applies next match. Your next match is first to ${value}.`;
    }

    function syncSettingsUI(p) {
        if (!p) return;
        setPressed(difficultyBtns, p.difficulty, 'difficulty');
        if (difficultyDesc) difficultyDesc.textContent = difficultyDescriptions[p.difficulty] || difficultyDescriptions.medium;
        if (difficultyDisplay) difficultyDisplay.innerHTML = `<span>${p.difficulty.charAt(0).toUpperCase() + p.difficulty.slice(1)}</span>`;
        setPressed(targetBtns, p.matchTarget, 'target');
        if (targetNote) targetNote.textContent = targetNoteText(p.matchTarget);

        if (soundBtn) {
            soundBtn.setAttribute('aria-checked', p.sound ? 'true' : 'false');
            soundBtn.classList.toggle('is-on', p.sound);
            const label = soundBtn.querySelector('span');
            if (label) label.textContent = p.sound ? 'On' : 'Off';
        }
        if (volumeInput) {
            volumeInput.value = String(Math.round(p.volume * 100));
            volumeInput.disabled = !p.sound;
        }
        if (volumeValue) volumeValue.textContent = `${Math.round(p.volume * 100)}%`;

        const supported = window.TableSettings ? window.TableSettings.hasHaptics() : false;
        if (hapticsBtn) {
            hapticsBtn.setAttribute('aria-checked', p.haptics && supported ? 'true' : 'false');
            hapticsBtn.classList.toggle('is-on', p.haptics && supported);
            hapticsBtn.disabled = !supported;
            const label = hapticsBtn.querySelector('span');
            if (label) label.textContent = supported ? (p.haptics ? 'On' : 'Off') : 'Not supported';
        }
        if (hapticsNote) {
            hapticsNote.textContent = supported ? 'On supported phones' : 'This device has no vibration';
        }
        setPressed(motionBtns, p.motion, 'motion');
        syncMute(p);
    }

    function syncMute(p) {
        if (!muteBtn) return;
        const muted = p ? !p.sound : false;
        muteBtn.classList.toggle('is-muted', muted);
        muteBtn.setAttribute('aria-pressed', muted ? 'true' : 'false');
        muteBtn.setAttribute('aria-label', muted ? 'Unmute sound' : 'Mute sound');
        muteBtn.title = muted ? 'Unmute sound' : 'Mute sound';
    }

    function applySettingsToEngine(p) {
        if (!p || typeof GameEngine === 'undefined') return;
        if (GameEngine.state.difficulty !== p.difficulty) GameEngine.setDifficulty(p.difficulty);
        if (GameEngine.state.pendingMatchTarget !== p.matchTarget) GameEngine.setMatchTarget(p.matchTarget);
    }

    function ensurePreferences() {
        if (!window.TableSettings) return;
        const stored = prefs();
        applySettingsToEngine(stored);
        syncSettingsUI(stored);
    }

    if (window.TableSettings) {
        syncSettingsUI(prefs());
        // The store is the single source of truth; a UI control only requests a
        // change, then this listener reflects the validated result everywhere.
        document.addEventListener('tablesettings:change', (ev) => {
            const p = ev.detail || prefs();
            applySettingsToEngine(p);
            syncSettingsUI(p);
        });
    }

    difficultyBtns.forEach((btn) => {
        btn.onclick = () => {
            const value = btn.dataset.difficulty;
            if (window.TableSettings) window.TableSettings.update({ difficulty: value });
            else { GameEngine.setDifficulty(value); syncSettingsUI({ ...prefs(), difficulty: value }); }
        };
    });

    targetBtns.forEach((btn) => {
        btn.onclick = () => {
            const value = Number(btn.dataset.target);
            if (window.TableSettings) window.TableSettings.update({ matchTarget: value });
            else GameEngine.setMatchTarget(value);
            if (targetNote) targetNote.textContent = targetNoteText(value);
            if (typeof GameAudio !== 'undefined') GameAudio.play('select');
        };
    });

    if (soundBtn) {
        soundBtn.onclick = () => {
            const p = prefs();
            if (!p || !window.TableSettings) return;
            window.TableSettings.update({ sound: !p.sound });
            if (!p.sound && window.GameAudio) { GameAudio.unlock(); GameAudio.play('select'); }
        };
    }

    if (volumeInput) {
        volumeInput.oninput = () => {
            const volume = Math.max(0, Math.min(1, Number(volumeInput.value) / 100));
            if (window.TableSettings) window.TableSettings.update({ volume });
            else if (volumeValue) volumeValue.textContent = `${Math.round(volume * 100)}%`;
        };
    }

    if (hapticsBtn) {
        hapticsBtn.onclick = () => {
            const p = prefs();
            if (!p || !window.TableSettings) return;
            window.TableSettings.update({ haptics: !p.haptics });
            if (p.haptics && window.GameHaptics) GameHaptics.vibrate('select');
        };
    }

    motionBtns.forEach((btn) => {
        btn.onclick = () => {
            if (window.TableSettings) window.TableSettings.update({ motion: btn.dataset.motion });
        };
    });

    if (muteBtn) {
        muteBtn.onclick = () => {
            if (window.GameAudio) {
                GameAudio.toggle();
                syncMute(prefs());
            }
        };
    }

    // -------------------------------------------------------------- modals
    function openSettings() {
        if (!settingsModal) return;
        settingsReturnFocus = document.activeElement;
        const p = prefs();
        if (p) {
            applySettingsToEngine(p);
            syncSettingsUI(p);
        }
        settingsModal.style.display = 'flex';
        focusSoon(settingsModal.querySelector('.target-btn.active') || settingsModal.querySelector('.difficulty-btn.active') || closeSettingsBtn);
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
        if (rulesOrigin === $('settings-rules') && settingsModal) {
            settingsModal.style.display = 'flex';
            focusSoon($('settings-rules'));
        } else if (rulesOrigin && rulesOrigin.isConnected) {
            focusSoon(rulesOrigin);
        }
        rulesOrigin = null;
    }

    function requestConfirm(title, copy, acceptLabel, onAccept) {
        if (!confirmModal) {
            if (window.confirm(copy)) onAccept();
            return;
        }
        confirmReturnFocus = document.activeElement;
        const titleEl = $('confirm-title');
        const copyEl = $('confirm-copy');
        const accept = $('confirm-accept');
        if (titleEl) titleEl.textContent = title;
        if (copyEl) copyEl.textContent = copy;
        if (accept) {
            accept.textContent = acceptLabel;
            accept.onclick = () => {
                closeConfirm();
                onAccept();
            };
        }
        confirmModal.style.display = 'flex';
        focusSoon($('confirm-cancel'));
    }

    function closeConfirm() {
        if (!confirmModal) return;
        confirmModal.style.display = 'none';
        if (confirmReturnFocus && confirmReturnFocus.isConnected) {
            try { confirmReturnFocus.focus({ preventScroll: true }); } catch (e) { /* detached */ }
        }
        confirmReturnFocus = null;
    }

    if (settingsBtn) settingsBtn.onclick = openSettings;
    if (settingsBtnMobile) settingsBtnMobile.onclick = openSettings;
    if (closeSettingsBtn) closeSettingsBtn.onclick = closeSettings;
    const confirmCancel = $('confirm-cancel');
    if (confirmCancel) confirmCancel.onclick = closeConfirm;

    // -------------------------------------------------------------- actions
    const startGameBtn = $('start-game');
    if (startGameBtn) startGameBtn.onclick = () => GameEngine.startGame();

    const newRoundBtn = $('new-round');
    if (newRoundBtn) newRoundBtn.onclick = () => {
        GameView.hideRoundSummary();
        GameEngine.startNewRound();
    };

    const restartBtn = $('restart-game');
    if (restartBtn) {
        restartBtn.onclick = () => {
            const gs = GameEngine.state;
            if (gs.gameStarted && !gs.gameOver) {
                requestConfirm(
                    'Start a new match?',
                    `The current score is ${gs.player.score} to ${gs.computer.score}. It will be cleared.`,
                    'Start new match',
                    () => GameEngine.restartGame()
                );
            } else {
                GameEngine.restartGame();
            }
        };
    }

    const playAgainBtn = $('play-again');
    if (playAgainBtn) playAgainBtn.onclick = () => {
        if (gameOverModal) gameOverModal.style.display = 'none';
        // The result screen is a clean boundary: reset and deal straight into
        // the next match rather than sending the player back to setup.
        GameEngine.restartGame();
        GameEngine.startGame();
    };

    const resultSettings = $('result-settings');
    if (resultSettings) resultSettings.onclick = openSettings;

    const exitGameBtn = $('exit-game');
    if (exitGameBtn) exitGameBtn.onclick = () => {
        if (window.confirm('Leave the table and return to the collection?')) {
            window.location.href = '../../index.html';
        }
    };

    const settingsTutorial = $('settings-tutorial');
    if (settingsTutorial) settingsTutorial.onclick = () => {
        closeSettings();
        const tutorial = window.Tutorial || window.AnneTutorial;
        if (tutorial && tutorial.open) tutorial.open(settingsTutorial);
    };

    // -------------------------------------------------------------- rules / log
    const startRulesBtn = $('start-rules');
    const hudRulesBtn = $('hud-rules');
    const showRulesBtn = $('show-rules');
    const closeRulesBtn = $('close-rules');

    if (startRulesBtn) startRulesBtn.onclick = () => openRules(startRulesBtn);
    if (hudRulesBtn) hudRulesBtn.onclick = () => openRules(hudRulesBtn);
    if (showRulesBtn) showRulesBtn.onclick = () => openRules(showRulesBtn);
    if (closeRulesBtn) closeRulesBtn.onclick = closeRules;

    const settingsGameLog = $('settings-game-log');
    const settingsRules = $('settings-rules');
    const closeLogBtn = $('close-log-modal');
    const clearLogBtn = $('clear-log');

    function openLog() {
        if (!logModal) return;
        if (settingsModal) settingsModal.style.display = 'none';
        logModal.style.display = 'flex';
        focusSoon(logModal.querySelector('.close-modal'));
    }

    if (settingsGameLog) settingsGameLog.onclick = openLog;
    if (settingsRules) settingsRules.onclick = () => openRules(settingsRules);
    if (closeLogBtn) closeLogBtn.onclick = () => {
        logModal.style.display = 'none';
        if (settingsModal) {
            settingsModal.style.display = 'flex';
            focusSoon($('settings-game-log'));
        }
    };
    if (clearLogBtn) clearLogBtn.onclick = () => GameView.clearLog();

    // Select Trump button (for when the sheet is dismissed without a choice)
    const selectTrumpBtn = $('select-trump-btn');
    if (selectTrumpBtn) selectTrumpBtn.onclick = () => GameEngine.reopenTrumpSelection();

    // -------------------------------------------------------------- modal dismiss
    document.addEventListener('click', (e) => {
        if (!e.target.classList.contains('modal')) return;
        if (e.target.id === 'coin-toss-modal') return;
        // A finished match keeps its result on screen until a real action is
        // chosen; a stray backdrop click must not hide the only summary.
        if (e.target.id === 'game-over-modal') return;
        if (e.target.id === 'confirm-modal') { closeConfirm(); return; }
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

    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape') return;
        if (isOpen(confirmModal)) { closeConfirm(); return; }
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

    ensurePreferences();
    GameEngine.ready();
}

// Start the game when page loads
document.addEventListener('DOMContentLoaded', initializeUI);
