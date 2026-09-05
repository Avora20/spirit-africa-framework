import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import StartGame, {
    EventBus,
    EVT_PHASE_CHANGED,
    EVT_STATE_UPDATED,
    EVT_RESUME_GAME,
    EVT_RETURN_TO_MENU,
    EVT_PAUSE_GAME,
    EVT_SCENE_READY,
    loadSave,
    writeSave,
    type GameSaveData,
} from './game/main';

// ---------------------------------------------------------------------------
// TYPES
// ---------------------------------------------------------------------------
type Screen =
    | 'MENU'
    | 'PLAYING'
    | 'PAUSED'
    | 'CHARACTER_VIEW'
    | 'MISSIONS_VIEW'
    | 'REWARDS_VIEW'
    | 'SETTINGS_VIEW';

interface PlayerState {
    x: number;
    y: number;
    level: number;
    zone: string;
}

// ---------------------------------------------------------------------------
// APP COMPONENT
// ---------------------------------------------------------------------------
function App() {
    const phaserRef = useRef<{ game: Phaser.Game | null; scene: Phaser.Scene | null } | null>(null);
    const [screen, setScreen] = useState<Screen>('MENU');
    const [playerState, setPlayerState] = useState<PlayerState>({ x: 200, y: 200, level: 1, zone: 'Baobab Heart' });
    const [saveData, setSaveData] = useState<GameSaveData>(() => loadSave());
    const [hasSave, setHasSave] = useState(() => {
        const data = loadSave();
        return data.currentLevel > 1 || data.lastPosition.x !== 200 || data.lastPosition.y !== 200;
    });

    // --- PHASER MOUNT ---
    useLayoutEffect(() => {
        if (phaserRef.current === null) {
            const game = StartGame('game-container');
            phaserRef.current = { game, scene: null };
        }

        const sceneHandler = (scene: Phaser.Scene) => {
            if (phaserRef.current) {
                phaserRef.current.scene = scene;
            }
        };

        EventBus.on(EVT_SCENE_READY, sceneHandler);

        return () => {
            EventBus.removeListener(EVT_SCENE_READY, sceneHandler);
            if (phaserRef.current) {
                phaserRef.current.game?.destroy(true);
                phaserRef.current = null;
            }
        };
    }, []);

    // --- EVENTBUS SUBSCRIPTIONS ---
    useEffect(() => {
        const onPhaseChanged = (phase: string) => {
            setScreen(phase as Screen);
        };

        const onStateUpdated = (data: PlayerState) => {
            setPlayerState(data);
        };

        EventBus.on(EVT_PHASE_CHANGED, onPhaseChanged);
        EventBus.on(EVT_STATE_UPDATED, onStateUpdated);

        return () => {
            EventBus.removeListener(EVT_PHASE_CHANGED, onPhaseChanged);
            EventBus.removeListener(EVT_STATE_UPDATED, onStateUpdated);
        };
    }, []);

    // --- ACTIONS ---
    const playGame = useCallback(() => {
        const newSave: GameSaveData = {
            ...saveData,
            currentLevel: 1,
            lastPosition: { x: 200, y: 200 },
        };
        writeSave(newSave);
        setSaveData(newSave);
        setScreen('PLAYING');
        EventBus.emit(EVT_PHASE_CHANGED, 'PLAYING');
    }, [saveData]);

    const continueGame = useCallback(() => {
        setScreen('PLAYING');
        EventBus.emit(EVT_PHASE_CHANGED, 'PLAYING');
    }, []);

    const openModal = useCallback((modal: Screen) => {
        setScreen(modal);
    }, []);

    const closeModal = useCallback(() => {
        setScreen('MENU');
    }, []);

    const resumeGame = useCallback(() => {
        EventBus.emit(EVT_RESUME_GAME);
        setScreen('PLAYING');
    }, []);

    const pauseGame = useCallback(() => {
        EventBus.emit(EVT_PAUSE_GAME);
        setScreen('PAUSED');
    }, []);

    const returnToMenu = useCallback(() => {
        EventBus.emit(EVT_RETURN_TO_MENU);
        setScreen('MENU');
    }, []);

    const saveSettings = useCallback((newSettings: GameSaveData['settings']) => {
        const updated = { ...saveData, settings: newSettings };
        writeSave(updated);
        setSaveData(updated);
    }, [saveData]);

    // --- RENDER ---
    return (
        <div id="app">
            <div id="game-container"></div>

            {/* ===== MAIN MENU ===== */}
            {screen === 'MENU' && (
                <div className="overlay menu-overlay">
                    <div className="menu-content">
                        <div className="game-title">
                            <h1>SPIRIT OF AFRICA</h1>
                            <p className="subtitle">An African Adventure Awaits</p>
                        </div>
                        <div className="menu-buttons">
                            <button className="btn btn-primary" onClick={playGame}>
                                ▶ Play
                            </button>
                            <button
                                className={`btn btn-secondary ${!hasSave ? 'btn-disabled' : ''}`}
                                onClick={continueGame}
                                disabled={!hasSave}
                            >
                                ⏩ Continue
                            </button>
                            <div className="menu-row">
                                <button className="btn btn-nav" onClick={() => openModal('CHARACTER_VIEW')}>
                                    👤 Character
                                </button>
                                <button className="btn btn-nav" onClick={() => openModal('MISSIONS_VIEW')}>
                                    📜 Missions
                                </button>
                            </div>
                            <div className="menu-row">
                                <button className="btn btn-nav" onClick={() => openModal('REWARDS_VIEW')}>
                                    🏆 Rewards
                                </button>
                                <button className="btn btn-nav" onClick={() => openModal('SETTINGS_VIEW')}>
                                    ⚙ Settings
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* ===== HUD (PLAYING) ===== */}
            {screen === 'PLAYING' && (
                <div className="overlay hud-overlay">
                    <div className="hud-top">
                        <div className="hud-info">
                            <span className="hud-zone">
                                <svg className="zone-emblem" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                                    <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeWidth="1.4" opacity="0.55" />
                                    <path d="M12 3 L14 10 L21 12 L14 14 L12 21 L10 14 L3 12 L10 10 Z" fill="currentColor" />
                                </svg>
                                <span className="hud-zone-name">{playerState.zone}</span>
                            </span>
                        </div>
                        <button className="btn-icon" onClick={pauseGame} title="Pause" aria-label="Pause">
                            <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
                                <rect x="6" y="5" width="4" height="14" rx="1.2" fill="currentColor" />
                                <rect x="14" y="5" width="4" height="14" rx="1.2" fill="currentColor" />
                            </svg>
                        </button>
                    </div>
                    <div className="hud-bottom">
                        <span className="hud-coords">
                            <svg className="coord-compass" viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
                                <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="1.3" opacity="0.6" />
                                <path d="M12 5 L14 12 L12 19 L10 12 Z" fill="currentColor" />
                            </svg>
                            {Math.round(playerState.x)} E, {Math.round(playerState.y)} S
                        </span>
                        <button className="btn btn-small" onClick={returnToMenu}>
                            ← Menu
                        </button>
                    </div>
                </div>
            )}

            {/* ===== PAUSE ===== */}
            {screen === 'PAUSED' && (
                <div className="overlay modal-overlay">
                    <div className="modal-card">
                        <h2>PAUSED</h2>
                        <div className="modal-buttons">
                            <button className="btn btn-primary" onClick={resumeGame}>
                                ▶ Resume
                            </button>
                            <button className="btn btn-secondary" onClick={() => openModal('SETTINGS_VIEW')}>
                                ⚙ Settings
                            </button>
                            <button className="btn btn-danger" onClick={returnToMenu}>
                                ✕ Main Menu
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* ===== CHARACTER VIEW ===== */}
            {screen === 'CHARACTER_VIEW' && (
                <div className="overlay modal-overlay">
                    <div className="modal-card">
                        <h2>CHARACTER</h2>
                        <div className="character-display">
                            <div className="char-portrait">
                                <div className="char-placeholder">
                                    <span>🗡</span>
                                </div>
                                <p className="char-name">{saveData.characterId === 'warrior_01' ? 'Ancestor Warrior' : 'Unknown'}</p>
                            </div>
                            <div className="char-stats">
                                <div className="stat-row"><span>Strength</span><div className="stat-bar"><div className="stat-fill" style={{ width: '60%' }}></div></div></div>
                                <div className="stat-row"><span>Speed</span><div className="stat-bar"><div className="stat-fill" style={{ width: '70%' }}></div></div></div>
                                <div className="stat-row"><span>Spirit</span><div className="stat-bar"><div className="stat-fill" style={{ width: '85%' }}></div></div></div>
                            </div>
                        </div>
                        <p className="coming-soon">More characters coming soon...</p>
                        <button className="btn btn-secondary" onClick={closeModal}>← Back</button>
                    </div>
                </div>
            )}

            {/* ===== MISSIONS VIEW ===== */}
            {screen === 'MISSIONS_VIEW' && (
                <div className="overlay modal-overlay">
                    <div className="modal-card">
                        <h2>MISSIONS</h2>
                        <div className="missions-list">
                            <div className="mission-item active">
                                <span className="mission-status">●</span>
                                <div>
                                    <p className="mission-title">The Savannah Awakening</p>
                                    <p className="mission-desc">Explore the Baobab Outpost and discover your spirit path.</p>
                                </div>
                            </div>
                            <div className="mission-item locked">
                                <span className="mission-status">🔒</span>
                                <div>
                                    <p className="mission-title">Whispers of the Ancestors</p>
                                    <p className="mission-desc">Coming soon...</p>
                                </div>
                            </div>
                            <div className="mission-item locked">
                                <span className="mission-status">🔒</span>
                                <div>
                                    <p className="mission-title">The Sacred Trail</p>
                                    <p className="mission-desc">Coming soon...</p>
                                </div>
                            </div>
                        </div>
                        <button className="btn btn-secondary" onClick={closeModal}>← Back</button>
                    </div>
                </div>
            )}

            {/* ===== REWARDS VIEW ===== */}
            {screen === 'REWARDS_VIEW' && (
                <div className="overlay modal-overlay">
                    <div className="modal-card">
                        <h2>REWARDS</h2>
                        <div className="rewards-grid">
                            <div className="reward-item claimed">
                                <span className="reward-icon">🌟</span>
                                <p>Daily Login</p>
                            </div>
                            <div className="reward-item">
                                <span className="reward-icon">🎁</span>
                                <p>Explorer Pack</p>
                            </div>
                            <div className="reward-item locked">
                                <span className="reward-icon">🔒</span>
                                <p>Level 5</p>
                            </div>
                            <div className="reward-item locked">
                                <span className="reward-icon">🔒</span>
                                <p>Level 10</p>
                            </div>
                        </div>
                        <p className="coming-soon">More rewards coming soon...</p>
                        <button className="btn btn-secondary" onClick={closeModal}>← Back</button>
                    </div>
                </div>
            )}

            {/* ===== SETTINGS VIEW ===== */}
            {screen === 'SETTINGS_VIEW' && (
                <div className="overlay modal-overlay">
                    <div className="modal-card">
                        <h2>SETTINGS</h2>
                        <div className="settings-list">
                            <label className="setting-row">
                                <span>Sound Effects</span>
                                <input
                                    type="checkbox"
                                    checked={saveData.settings.soundEnabled}
                                    onChange={(e) => saveSettings({ ...saveData.settings, soundEnabled: e.target.checked })}
                                />
                            </label>
                            <label className="setting-row">
                                <span>Music</span>
                                <input
                                    type="checkbox"
                                    checked={saveData.settings.musicEnabled}
                                    onChange={(e) => saveSettings({ ...saveData.settings, musicEnabled: e.target.checked })}
                                />
                            </label>
                            <label className="setting-row">
                                <span>Touch Controls</span>
                                <input
                                    type="checkbox"
                                    checked={saveData.settings.touchControls}
                                    onChange={(e) => saveSettings({ ...saveData.settings, touchControls: e.target.checked })}
                                />
                            </label>
                        </div>
                        <button className="btn btn-secondary" onClick={() => {
                            if (screen === 'SETTINGS_VIEW' && phaserRef.current?.scene) {
                                closeModal();
                            } else {
                                closeModal();
                            }
                        }}>← Back</button>
                    </div>
                </div>
            )}
        </div>
    );
}

export default App;