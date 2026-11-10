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
    const historyModal = $('match-history-modal');
    const trumpModal = $('trump-selection-modal');
    const confirmModal = $('confirm-modal');
    const gameOverModal = $('game-over-modal');

    let settingsReturnFocus = null;
    let rulesOrigin = null;
    let confirmReturnFocus = null;
    let historyOrigin = null;

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
    const soundTestBtn = $('sound-test');
    const volumeInput = $('settings-volume');
    const volumeValue = $('volume-value');
    const hapticsBtn = $('settings-haptics');
    const voiceBtn = $('settings-voice');
    const voiceTestBtn = $('voice-test');
    const hapticsNote = $('haptics-note');
    const fireworksBtn = $('settings-fireworks');
    const motionBtns = document.querySelectorAll('.motion-btn');
    const segmentGroups = [...document.querySelectorAll('.difficulty-options, .target-options, .motion-options')];

    function ensureSegmentThumb(group) {
        let thumb = group.querySelector(':scope > .seg-thumb');
        if (!thumb) {
            thumb = document.createElement('span');
            thumb.className = 'seg-thumb';
            thumb.setAttribute('aria-hidden', 'true');
            group.prepend(thumb);
            group.classList.add('has-seg-thumb');
        }
        return thumb;
    }

    // One shared thumb travels between equal-width choices. Measuring the
    // active button keeps the highlight aligned with real text and borders,
    // including when the settings sheet changes width at a breakpoint.
    function positionSegments() {
        segmentGroups.forEach((group) => {
            const thumb = ensureSegmentThumb(group);
            const active = group.querySelector('button.active');
            if (!active || !group.clientWidth) {
                thumb.style.opacity = '0';
                return;
            }
            // offsetLeft/offsetTop are layout coordinates inside the group;
            // they stay stable while the sheet is scaled or animated.
            thumb.style.opacity = '1';
            thumb.style.width = `${active.offsetWidth}px`;
            thumb.style.height = `${active.offsetHeight}px`;
            thumb.style.transform = `translate3d(${active.offsetLeft}px, ${active.offsetTop}px, 0)`;
        });
    }

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
        positionSegments();
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
        if (voiceBtn) {
            const voiceOn = p.voice !== false && p.sound !== false;
            voiceBtn.setAttribute('aria-checked', voiceOn ? 'true' : 'false');
            voiceBtn.classList.toggle('is-on', voiceOn);
            voiceBtn.disabled = p.sound === false;
            const voiceLabel = voiceBtn.querySelector('span');
            if (voiceLabel) voiceLabel.textContent = p.voice !== false ? (voiceOn ? 'On' : 'Sound off') : 'Off';
        }
        if (voiceTestBtn) voiceTestBtn.disabled = p.voice === false || p.sound === false;

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
        if (fireworksBtn) {
            fireworksBtn.setAttribute('aria-checked', p.fireworks ? 'true' : 'false');
            fireworksBtn.classList.toggle('is-on', !!p.fireworks);
            const label = fireworksBtn.querySelector('span');
            if (label) label.textContent = p.fireworks ? 'On' : 'Off';
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

    // A setting toggled over a finished result should affect the celebration
    // immediately, without making the player start another match to see it.
    function syncFireworksForResult(p) {
        const modal = $('game-over-modal');
        if (!modal || modal.style.display !== 'flex' || !window.TableFireworks) return;
        if (!p.fireworks) { window.TableFireworks.stop(); return; }
        if (modal.classList.contains('is-win') && !window.TableFireworks.active()) {
            window.TableFireworks.start();
        }
    }

    if (window.TableSettings) {
        syncSettingsUI(prefs());
        // The store is the single source of truth; a UI control only requests a
        // change, then this listener reflects the validated result everywhere.
        document.addEventListener('tablesettings:change', (ev) => {
            const p = ev.detail || prefs();
            applySettingsToEngine(p);
            syncSettingsUI(p);
            syncFireworksForResult(p);
        });
    }

    window.addEventListener('resize', () => requestAnimationFrame(positionSegments));
    if (document.fonts && document.fonts.ready) {
        document.fonts.ready.then(positionSegments).catch(() => {});
    }
    // Watch the groups themselves, not just the window. A settings sheet that
    // changes width at a breakpoint can resize after the window event, and the
    // thumb must not keep the desktop width on a phone.
    if (window.ResizeObserver) {
        const segmentObserver = new ResizeObserver(() => requestAnimationFrame(positionSegments));
        segmentGroups.forEach((group) => segmentObserver.observe(group));
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

    // Turning her voice on greets the player, which also proves the chosen
    // system voice is audible; turning it off stops a line already in flight.
    if (voiceBtn) {
        voiceBtn.onclick = () => {
            const p = prefs();
            if (!p || !window.TableSettings) return;
            window.TableSettings.update({ voice: !p.voice });
            if (!p.voice) { if (window.AnneVoice) window.AnneVoice.greet(); }
            else if (window.AnneVoice) window.AnneVoice.stop();
        };
    }

    if (voiceTestBtn) {
        voiceTestBtn.onclick = () => {
            if (window.AnneVoice) window.AnneVoice.greet();
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

    if (fireworksBtn) {
        fireworksBtn.onclick = () => {
            const p = prefs();
            if (!p || !window.TableSettings) return;
            window.TableSettings.update({ fireworks: !p.fireworks });
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

    if (soundTestBtn) {
        soundTestBtn.onclick = () => {
            if (!window.GameAudio) return;
            GameAudio.unlock();
            GameAudio.test();
        };
    }

    // A soft tick makes the whole interface feel connected. Individual controls
    // still play their own, more specific sound where that helps.
    document.addEventListener('click', (ev) => {
        const btn = ev.target.closest && ev.target.closest('button');
        if (!btn || btn.disabled || !window.GameAudio) return;
        if (btn.matches('.coin-btn, .trump-btn, .card')) return;
        GameAudio.play('select');
    });

    // -------------------------------------------------------------- modals
    function openSettings() {
        if (!settingsModal) return;
        settingsReturnFocus = document.activeElement;
        const p = prefs();
        settingsModal.style.display = 'flex';
        // Geometry is zero while the dialog is display:none. Sync after showing
        // it, then position the thumbs on the next frame when layout is settled.
        if (p) {
            applySettingsToEngine(p);
            syncSettingsUI(p);
        }
        requestAnimationFrame(positionSegments);
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
            // Restore immediately, then once more after the dialog is gone; a
            // suspended tab can delay the timer past a keyboard user's next key.
            try { rulesOrigin.focus({ preventScroll: true }); } catch (e) { /* detached */ }
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

    function openHistory(origin) {
        if (!historyModal) return;
        historyOrigin = origin || $('settings-match-history');
        if (settingsModal) settingsModal.style.display = 'none';
        if (window.MatchHistory) window.MatchHistory.render($('match-history-list'));
        historyModal.style.display = 'flex';
        focusSoon($('close-history'));
    }

    function closeHistory() {
        if (!historyModal) return;
        historyModal.style.display = 'none';
        if (settingsModal) {
            settingsModal.style.display = 'flex';
            focusSoon($('settings-match-history'));
        } else if (historyOrigin && historyOrigin.isConnected) {
            focusSoon(historyOrigin);
        }
        historyOrigin = null;
    }

    if (settingsGameLog) settingsGameLog.onclick = openLog;
    const settingsMatchHistory = $('settings-match-history');
    if (settingsMatchHistory) settingsMatchHistory.onclick = () => openHistory(settingsMatchHistory);
    const closeHistoryBtn = $('close-history');
    if (closeHistoryBtn) closeHistoryBtn.onclick = closeHistory;
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
        if (e.target.id === 'match-history-modal') { closeHistory(); return; }
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
        if (isOpen(historyModal)) { closeHistory(); return; }
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
    // Restore after preferences so the current difficulty and pending match
    // target win over whatever was saved with the interrupted match.
    if (!GameEngine.restoreSavedGame()) GameEngine.ready();
}

// Start the game when page loads
document.addEventListener('DOMContentLoaded', initializeUI);
