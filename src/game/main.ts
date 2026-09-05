import { AUTO, Events, Game as PhaserGame, Scale, Scene } from 'phaser';

// ---------------------------------------------------------------------------
// GAME CONSTANTS — inline here; do NOT create a constants.ts file.
// ---------------------------------------------------------------------------
export const GAME_WIDTH = 960;
export const GAME_HEIGHT = 540;
export const WORLD_W = 2000;
export const WORLD_H = 1400;

export const COLORS = {
    SAVANNAH_GOLD: 0xe5a93b,
    TERRACOTTA: 0xd35400,
    EARTH_OCHRE: 0x7c3f1d,
    DEEP_NIGHT: 0x1a130e,
    TRIBAL_EMERALD: 0x27ae60,
    PARCHMENT: 0xfdfbf7,
    SKY: '#1a130e',
    GROUND: '#c4903a',
    PATH: '#a0722a',
    TEXT: '#fdfbf7',
} as const;

// Event name constants — single source of truth
export const EVT_SCENE_READY = 'current-scene-ready';
export const EVT_PHASE_CHANGED = 'phase-changed';
export const EVT_STATE_UPDATED = 'state-updated';
export const EVT_RESUME_GAME = 'resume-game';
export const EVT_RETURN_TO_MENU = 'return-to-menu';
export const EVT_PAUSE_GAME = 'pause-game';

// ---------------------------------------------------------------------------
// SAVE DATA SCHEMA
// ---------------------------------------------------------------------------
export interface GameSaveData {
    currentLevel: number;
    characterId: string;
    unlockedCharacters: string[];
    completedMissions: string[];
    claimedRewards: string[];
    settings: {
        soundEnabled: boolean;
        musicEnabled: boolean;
        touchControls: boolean;
    };
    lastPosition: { x: number; y: number };
}

const SAVE_KEY = 'spirit_of_africa_save_v1';

export function loadSave(): GameSaveData {
    try {
        const raw = localStorage.getItem(SAVE_KEY);
        if (raw) return JSON.parse(raw) as GameSaveData;
    } catch { /* ignore */ }
    return {
        currentLevel: 1,
        characterId: 'warrior_01',
        unlockedCharacters: ['warrior_01'],
        completedMissions: [],
        claimedRewards: [],
        settings: { soundEnabled: true, musicEnabled: true, touchControls: true },
        lastPosition: { x: 200, y: 200 },
    };
}

export function writeSave(data: GameSaveData): void {
    try {
        localStorage.setItem(SAVE_KEY, JSON.stringify(data));
    } catch { /* ignore */ }
}

// ---------------------------------------------------------------------------
// EVENT BUS — shared React <-> Phaser bridge (named export).
// ---------------------------------------------------------------------------
export const EventBus = new Events.EventEmitter();

// ---------------------------------------------------------------------------
// PHASER GAME FACTORY
// ---------------------------------------------------------------------------
const StartGame = (parent: string) => {
    const config: Phaser.Types.Core.GameConfig = {
        type: AUTO,
        width: GAME_WIDTH,
        height: GAME_HEIGHT,
        parent,
        backgroundColor: COLORS.SKY,
        scale: {
            mode: Scale.FIT,
            autoCenter: Scale.CENTER_BOTH,
        },
        physics: {
            default: 'arcade',
            arcade: { gravity: { x: 0, y: 0 }, debug: false },
        },
        scene: [Game],
    };

    const game = new PhaserGame(config);
    if (typeof window !== 'undefined') {
        (window as any).__PHASER_GAME__ = game;
        (window as any).__PHASER_EVENT_BUS__ = EventBus;
    }
    return game;
};

// ---------------------------------------------------------------------------
// THE GAME SCENE — Savannah Plateau: exploration, movement polish, landmarks.
// ---------------------------------------------------------------------------
type Facing = 'down' | 'up' | 'left' | 'right';

const PLAYER_SPEED = 240;
const PLAYER_ACCEL = 1600;
const PLAYER_FRICTION = 1200;
const FRAME_W = 48;
const FRAME_H = 60;

export class Game extends Scene {
    private player!: Phaser.Physics.Arcade.Sprite;
    private keys!: Record<string, Phaser.Input.Keyboard.Key>;
    private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
    private touchDir: { x: number; y: number } = { x: 0, y: 0 };
    private isPaused = false;
    private stateTimer: Phaser.Time.TimerEvent | null = null;
    private groundBodies!: Phaser.Physics.Arcade.StaticGroup;
    private decorations!: Phaser.GameObjects.Group;
    private facing: Facing = 'down';
    private lastEmitZone = '';
    private dustEmitter!: Phaser.GameObjects.Particles.ParticleEmitter;
    private emberEmitter!: Phaser.GameObjects.Particles.ParticleEmitter;
    private pollenEmitter!: Phaser.GameObjects.Particles.ParticleEmitter;

    constructor() {
        super('Game');
    }

    preload() {
        // All textures are generated procedurally in create() — no external assets needed.
    }

    create() {
        // --- PROCEDURAL TEXTURES ---
        this.generateTextures();

        // --- WORLD SETUP ---
        this.physics.world.setBounds(0, 0, WORLD_W, WORLD_H);
        this.cameras.main.setBounds(0, 0, WORLD_W, WORLD_H);

        // --- GROUND TERRAIN ---
        this.createTerrain();

        // --- BOUNDARY COLLIDERS ---
        this.physics.world.setBoundsCollision(true, true, true, true);
        this.groundBodies = this.physics.add.staticGroup();

        // --- DECORATIONS GROUP ---
        this.decorations = this.add.group();
        this.createDecorations();

        // --- PLAYER ---
        this.createPlayer();

        // --- CAMERA FOLLOW (smooth lerp, centered framing) ---
        this.cameras.main.startFollow(this.player, true, 0.08, 0.08);
        this.cameras.main.setDeadzone(120, 120);

        // --- INPUT ---
        this.keys = this.input.keyboard!.addKeys('W,A,S,D') as Record<string, Phaser.Input.Keyboard.Key>;
        this.cursors = this.input.keyboard!.createCursorKeys();

        // Pause key
        this.input.keyboard!.on('keydown-ESC', () => this.togglePause());
        this.input.keyboard!.on('keydown-P', () => this.togglePause());

        // --- TOUCH INPUT (virtual joystick zone) ---
        this.input.addPointer(1);
        this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
            if (pointer.y > this.scale.height * 0.6) {
                this.updateTouchDir(pointer);
            }
        });
        this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
            if (pointer.isDown && pointer.y > this.scale.height * 0.6) {
                this.updateTouchDir(pointer);
            }
        });
        this.input.on('pointerup', () => {
            this.touchDir = { x: 0, y: 0 };
        });

        // --- EVENTBUS LISTENERS (React -> Scene) ---
        EventBus.on(EVT_RESUME_GAME, this.onResume, this);
        EventBus.on(EVT_RETURN_TO_MENU, this.returnToMenu, this);
        EventBus.on(EVT_PAUSE_GAME, this.onPause, this);

        // --- EMIT READY ---
        EventBus.emit(EVT_SCENE_READY, this);
        EventBus.emit(EVT_PHASE_CHANGED, 'MENU');

        // --- STATE UPDATE TIMER ---
        this.stateTimer = this.time.addEvent({
            delay: 200,
            loop: true,
            callback: () => {
                if (this.player && !this.isPaused) {
                    const zone = this.getZoneName();
                    this.lastEmitZone = zone;
                    EventBus.emit(EVT_STATE_UPDATED, {
                        x: Math.round(this.player.x),
                        y: Math.round(this.player.y),
                        level: 1,
                        zone,
                    });
                }
            },
        });

        // --- SHUTDOWN CLEANUP ---
        this.events.once('shutdown', () => {
            this.time.removeAllEvents();
            this.tweens.killAll();
            this.input.keyboard?.removeAllListeners();
            this.sound.stopAll();
            EventBus.off(EVT_RESUME_GAME, this.onResume, this);
            EventBus.off(EVT_RETURN_TO_MENU, this.returnToMenu, this);
            EventBus.off(EVT_PAUSE_GAME, this.onPause, this);
        });
    }

    update(_time: number, _delta: number) {
        if (this.isPaused || !this.player) return;

        let vx = 0;
        let vy = 0;

        // Keyboard input
        if (this.keys.A?.isDown || this.cursors.left?.isDown) vx = -1;
        if (this.keys.D?.isDown || this.cursors.right?.isDown) vx = 1;
        if (this.keys.W?.isDown || this.cursors.up?.isDown) vy = -1;
        if (this.keys.S?.isDown || this.cursors.down?.isDown) vy = 1;

        // Touch input (additive)
        if (this.touchDir.x !== 0 || this.touchDir.y !== 0) {
            vx = this.touchDir.x;
            vy = this.touchDir.y;
        }

        // Normalize diagonal / 8-directional movement
        const len = Math.sqrt(vx * vx + vy * vy);
        if (len > 1) {
            vx /= len;
            vy /= len;
        }

        const body = this.player.body as Phaser.Physics.Arcade.Body;
        if (vx !== 0 || vy !== 0) {
            // Smooth acceleration toward target velocity
            const targetVx = vx * PLAYER_SPEED;
            const targetVy = vy * PLAYER_SPEED;
            const dt = _delta / 1000;
            body.velocity.x = this.approach(body.velocity.x, targetVx, PLAYER_ACCEL * dt);
            body.velocity.y = this.approach(body.velocity.y, targetVy, PLAYER_ACCEL * dt);
            this.updateFacing(vx, vy);
            this.player.play(this.animKey(this.facing), true);
            this.emitStepDust();
        } else {
            // Natural friction deceleration when idle
            const dt = _delta / 1000;
            body.velocity.x = this.approach(body.velocity.x, 0, PLAYER_FRICTION * dt);
            body.velocity.y = this.approach(body.velocity.y, 0, PLAYER_FRICTION * dt);
            if (this.player.anims.isPlaying) this.player.anims.stop();
            this.player.setTexture('player_sheet', this.frameIndex(this.facing, 0));
        }

        // Strict world clamp (belt-and-suspenders with collideWorldBounds)
        this.player.x = Math.max(24, Math.min(WORLD_W - 24, this.player.x));
        this.player.y = Math.max(30, Math.min(WORLD_H - 24, this.player.y));
    }

    // --- PRIVATE HELPERS ---

    private approach(current: number, target: number, maxDelta: number): number {
        if (current < target) return Math.min(current + maxDelta, target);
        if (current > target) return Math.max(current - maxDelta, target);
        return target;
    }

    private frameIndex(dir: Facing, step: number): number {
        // 4 directions x 4 stride frames = 16 frames total
        const base = dir === 'down' ? 0 : dir === 'up' ? 4 : dir === 'left' ? 8 : 12;
        return base + (step % 4);
    }

    private animKey(dir: Facing): string {
        return `walk_${dir}`;
    }

    private updateFacing(vx: number, vy: number) {
        let f: Facing;
        if (Math.abs(vx) > Math.abs(vy)) f = vx > 0 ? 'right' : 'left';
        else f = vy > 0 ? 'down' : 'up';
        this.facing = f;
    }

    private emitStepDust() {
        if (!this.dustEmitter) return;
        if (Math.random() < 0.25) {
            this.dustEmitter.emitParticleAt(this.player.x, this.player.y + 18, 1);
        }
    }

    private updateTouchDir(pointer: Phaser.Input.Pointer) {
        const cx = this.scale.width / 2;
        const cy = this.scale.height * 0.8;
        let dx = (pointer.x - cx) / 80;
        let dy = (pointer.y - cy) / 80;
        const len = Math.sqrt(dx * dx + dy * dy);
        if (len > 1) { dx /= len; dy /= len; }
        this.touchDir = { x: dx, y: dy };
    }

    private togglePause() {
        this.isPaused = !this.isPaused;
        if (this.isPaused) {
            this.physics.world.pause();
            this.tweens.pauseAll();
            EventBus.emit(EVT_PHASE_CHANGED, 'PAUSED');
        } else {
            this.physics.world.resume();
            this.tweens.resumeAll();
            EventBus.emit(EVT_PHASE_CHANGED, 'PLAYING');
        }
    }

    private onResume() {
        if (this.isPaused) {
            this.isPaused = false;
            this.physics.world.resume();
            this.tweens.resumeAll();
            EventBus.emit(EVT_PHASE_CHANGED, 'PLAYING');
        }
    }

    private onPause() {
        if (!this.isPaused) {
            this.isPaused = true;
            this.physics.world.pause();
            this.tweens.pauseAll();
            EventBus.emit(EVT_PHASE_CHANGED, 'PAUSED');
        }
    }

    private returnToMenu() {
        this.isPaused = false;
        EventBus.emit(EVT_PHASE_CHANGED, 'MENU');
    }

    // Zone detection based on actual landmark coordinates
    private getZoneName(): string {
        const px = this.player.x;
        const py = this.player.y;
        // Sacred Shrine at the plateau heart (center)
        if (Math.hypot(px - WORLD_W / 2, py - WORLD_H / 2) < 260) return 'Sacred Shrine';
        // Great Baobab Grove — cluster of baobabs in the NW
        if (px < WORLD_W * 0.35 && py < WORLD_H * 0.4) return 'Great Baobab Grove';
        // Red Clay Ridge — eastern band
        if (px > WORLD_W * 0.68) return 'Red Clay Ridge';
        // Standing Stones circle — SW
        if (px < WORLD_W * 0.4 && py > WORLD_H * 0.6) return 'Ancestor Stone Circle';
        // Emerald Grasslands — northern strip
        if (py < WORLD_H * 0.28) return 'Golden Grasslands';
        return 'Savannah Plateau';
    }

    private generateTextures() {
        // Soft footstep dust puff
        if (!this.textures.exists('dust')) {
            const g = this.add.graphics();
            g.fillStyle(0xffffff, 1);
            g.fillCircle(6, 6, 6);
            g.generateTexture('dust', 12, 12);
            g.destroy();
        }
        // Ember spark (small bright dot with warm glow)
        if (!this.textures.exists('spark')) {
            const g = this.add.graphics();
            g.fillStyle(0xffcc66, 0.6);
            g.fillCircle(5, 5, 5);
            g.fillStyle(0xffffff, 1);
            g.fillCircle(5, 5, 2.5);
            g.generateTexture('spark', 10, 10);
            g.destroy();
        }
        // Soft glow mote (for ambient pollen/dust)
        if (!this.textures.exists('glow')) {
            const g = this.add.graphics();
            g.fillStyle(0xfff8e0, 0.4);
            g.fillCircle(8, 8, 8);
            g.fillStyle(0xffffff, 0.8);
            g.fillCircle(8, 8, 4);
            g.generateTexture('glow', 16, 16);
            g.destroy();
        }
    }

    private createTerrain() {
        // Main ground fill — rich multi-tone red/brown African soil
        const ground = this.add.graphics();
        ground.fillStyle(0xb44c1d, 1); // red terracotta base
        ground.fillRect(0, 0, WORLD_W, WORLD_H);

        // Broad ochre / savannah-gold soil variation patches
        const soilTones = [0xd99b26, 0x85441d, 0xc4903a, 0x9a5b2a, 0xb44c1d];
        for (let i = 0; i < 70; i++) {
            const tone = soilTones[i % soilTones.length];
            ground.fillStyle(tone, 0.18 + Math.random() * 0.18);
            ground.fillEllipse(
                Math.random() * WORLD_W,
                Math.random() * WORLD_H,
                90 + Math.random() * 160,
                50 + Math.random() * 90
            );
        }

        // Winding dirt paths (sun-baked clay)
        ground.fillStyle(0xd9b382, 0.55);
        ground.fillEllipse(WORLD_W / 2, WORLD_H / 2, 360, 220);
        for (let t = 0; t < 1.0; t += 0.04) {
            const px = WORLD_W * 0.12 + t * WORLD_W * 0.78;
            const py = WORLD_H * 0.5 + Math.sin(t * Math.PI * 2.2) * 220;
            ground.fillCircle(px, py, 34);
        }
        for (let t = 0; t < 1.0; t += 0.04) {
            const px = WORLD_W * 0.5 + Math.cos(t * Math.PI * 1.8) * 520;
            const py = WORLD_H * 0.12 + t * WORLD_H * 0.78;
            ground.fillCircle(px, py, 30);
        }

        // Golden savannah grass field patches
        ground.fillStyle(0x8db832, 0.32);
        const grassPositions: [number, number][] = [
            [200, 200], [520, 140], [900, 260], [1300, 180], [1700, 320],
            [300, 700], [760, 980], [1150, 560], [1520, 860], [1820, 1100],
            [160, 1250], [560, 1320], [1000, 1200], [1420, 1280], [1860, 1320],
            [420, 420], [880, 640], [1280, 720], [1640, 520], [1900, 760],
        ];
        for (const [gx, gy] of grassPositions) {
            ground.fillEllipse(gx, gy, 160 + Math.random() * 120, 90 + Math.random() * 60);
        }

        // Emerald grass accents
        ground.fillStyle(0x2f8f4e, 0.22);
        for (let i = 0; i < 26; i++) {
            ground.fillEllipse(
                120 + Math.random() * (WORLD_W - 240),
                120 + Math.random() * (WORLD_H - 240),
                70 + Math.random() * 60,
                40 + Math.random() * 30
            );
        }

        ground.setDepth(-10);
    }

    private createDecorations() {
        // --- UMBRELLA ACACIA TREES (organic, layered canopies) ---
        const acaciaPositions: [number, number][] = [
            [180, 160], [640, 120], [1080, 200], [1520, 140], [1860, 300],
            [300, 520], [760, 460], [1240, 540], [1680, 620], [150, 980],
            [520, 1120], [980, 1040], [1440, 980], [1840, 1140], [700, 760],
            [1180, 820], [1620, 780], [420, 860], [900, 360], [1360, 300],
        ];
        for (const [tx, ty] of acaciaPositions) {
            this.drawAcacia(tx, ty);
        }

        // --- MASSIVE LANDMARK BAOBAB TREES ---
        const baobabPositions: [number, number][] = [
            [320, 360], [1680, 420], [980, 1180], [460, 1080], [1520, 220],
        ];
        for (const [bx, by] of baobabPositions) {
            this.drawBaobab(bx, by);
        }

        // --- STANDING STONE CIRCLE (Ancestor circle, SW) ---
        const circleCx = 360, circleCy = 1040;
        for (let i = 0; i < 7; i++) {
            const a = (i / 7) * Math.PI * 2;
            const sx = circleCx + Math.cos(a) * 110;
            const sy = circleCy + Math.sin(a) * 70;
            this.drawStandingStone(sx, sy);
        }

        // --- WEATHERED GRANITE BOULDERS ---
        const rockPositions: [number, number][] = [
            [420, 300], [880, 240], [1280, 420], [1680, 520], [560, 680],
            [1040, 720], [1480, 680], [240, 820], [780, 1100], [1220, 1080],
            [1640, 1020], [360, 1240], [900, 1280], [1380, 1240], [1820, 900],
        ];
        for (const [rx, ry] of rockPositions) {
            this.drawBoulder(rx, ry);
        }

        // --- SAVANNAH GRASS TUFTS (golden & emerald, wind-swaying) ---
        for (let i = 0; i < 160; i++) {
            const gx = 60 + Math.random() * (WORLD_W - 120);
            const gy = 60 + Math.random() * (WORLD_H - 120);
            // keep clear of the shrine pedestal footprint
            if (Math.hypot(gx - WORLD_W / 2, gy - WORLD_H / 2) < 150) continue;
            this.drawGrassTuft(gx, gy);
        }

        // --- WILDFLOWER PATCHES ---
        for (let i = 0; i < 40; i++) {
            const fx = 80 + Math.random() * (WORLD_W - 160);
            const fy = 80 + Math.random() * (WORLD_H - 160);
            if (Math.hypot(fx - WORLD_W / 2, fy - WORLD_H / 2) < 160) continue;
            const flower = this.add.graphics();
            const col = [0xe0659a, 0xf2d24b, 0xffffff, 0xc062d9][i % 4];
            flower.fillStyle(col, 1);
            for (let p = 0; p < 3; p++) {
                flower.fillCircle(fx + p * 6 - 6, fy + (p % 2) * 4, 2.5);
            }
            flower.setDepth(-2);
            this.decorations.add(flower);
        }

        // --- SACRED SHRINE LANDMARK (plateau heart) ---
        this.createShrine();

        // --- AMBIENT POLLEN / DUST MOTES ---
        this.createAmbientMotes();
    }

    private drawAcacia(tx: number, ty: number) {
        const g = this.add.graphics();
        const scale = 0.8 + Math.random() * 0.5;
        // trunk (splitting branches)
        g.fillStyle(0x5c3317, 1);
        g.fillRect(tx - 4 * scale, ty - 18 * scale, 8 * scale, 40 * scale);
        g.lineStyle(4 * scale, 0x4a2810, 1);
        g.lineBetween(tx, ty - 14 * scale, tx - 16 * scale, ty - 30 * scale);
        g.lineBetween(tx, ty - 14 * scale, tx + 16 * scale, ty - 30 * scale);
        // umbrella layered canopy
        g.fillStyle(0x2d7a3a, 1);
        g.fillEllipse(tx, ty - 34 * scale, 70 * scale, 26 * scale);
        g.fillStyle(0x3a9448, 0.9);
        g.fillEllipse(tx - 14 * scale, ty - 32 * scale, 44 * scale, 20 * scale);
        g.fillEllipse(tx + 16 * scale, ty - 33 * scale, 40 * scale, 18 * scale);
        g.fillStyle(0x6fbf4a, 0.55);
        g.fillEllipse(tx + 2 * scale, ty - 40 * scale, 46 * scale, 14 * scale);
        g.setDepth(-5);
        this.decorations.add(g);
    }

    private drawBaobab(bx: number, by: number) {
        const g = this.add.graphics();
        const s = 1.4 + Math.random() * 0.5;
        // massive swollen trunk
        g.fillStyle(0x6b4423, 1);
        g.fillEllipse(bx, by - 10 * s, 40 * s, 70 * s);
        g.fillStyle(0x5c3317, 1);
        g.fillEllipse(bx - 6 * s, by - 12 * s, 22 * s, 58 * s);
        // stubby twisted branches (upside-down look)
        g.lineStyle(6 * s, 0x4a2810, 1);
        g.lineBetween(bx, by - 42 * s, bx - 26 * s, by - 64 * s);
        g.lineBetween(bx, by - 42 * s, bx + 28 * s, by - 62 * s);
        g.lineBetween(bx, by - 40 * s, bx - 12 * s, by - 70 * s);
        g.lineBetween(bx, by - 40 * s, bx + 14 * s, by - 68 * s);
        g.lineStyle(4 * s, 0x4a2810, 1);
        g.lineBetween(bx - 26 * s, by - 64 * s, bx - 38 * s, by - 78 * s);
        g.lineBetween(bx + 28 * s, by - 62 * s, bx + 40 * s, by - 76 * s);
        // sparse canopy tufts
        g.fillStyle(0x3a9448, 0.85);
        g.fillEllipse(bx - 36 * s, by - 80 * s, 26 * s, 12 * s);
        g.fillEllipse(bx + 38 * s, by - 78 * s, 24 * s, 12 * s);
        g.fillEllipse(bx, by - 72 * s, 30 * s, 14 * s);
        g.setDepth(-6);
        this.decorations.add(g);
    }

    private drawStandingStone(sx: number, sy: number) {
        const g = this.add.graphics();
        // shaded megalith
        g.fillStyle(0x4a4a4a, 1);
        g.fillRect(sx - 8, sy - 34, 16, 40);
        g.fillStyle(0x666666, 1);
        g.fillRect(sx - 8, sy - 34, 6, 40);
        g.fillStyle(0x333333, 0.8);
        g.fillRect(sx + 2, sy - 32, 6, 38);
        // carved line patterns
        g.lineStyle(1.5, 0xd9b382, 0.8);
        g.lineBetween(sx - 5, sy - 26, sx + 5, sy - 26);
        g.lineBetween(sx - 5, sy - 18, sx + 5, sy - 18);
        g.lineBetween(sx - 5, sy - 10, sx + 5, sy - 10);
        // moss cap
        g.fillStyle(0x27ae60, 0.7);
        g.fillEllipse(sx, sy - 34, 16, 5);
        g.setDepth(-3);
        this.decorations.add(g);
    }

    private drawBoulder(rx: number, ry: number) {
        const g = this.add.graphics();
        const w = 22 + Math.random() * 18;
        g.fillStyle(0x6b6b6b, 1);
        g.fillEllipse(rx, ry, w, w * 0.6);
        g.fillStyle(0x8a8a8a, 0.7);
        g.fillEllipse(rx - w * 0.15, ry - w * 0.12, w * 0.55, w * 0.35);
        g.fillStyle(0x444444, 0.5);
        g.fillEllipse(rx + w * 0.2, ry + w * 0.1, w * 0.4, w * 0.2);
        g.setDepth(-4);
        this.decorations.add(g);
    }

    private drawGrassTuft(gx: number, gy: number) {
        const g = this.add.graphics();
        const golden = Math.random() > 0.4;
        const col = golden ? 0xd99b26 : 0x2f8f4e;
        g.lineStyle(2, col, 0.9);
        const h = 10 + Math.random() * 8;
        for (let b = -2; b <= 2; b++) {
            g.lineBetween(gx + b * 3, gy, gx + b * 3 + b, gy - h);
        }
        g.setDepth(-2);
        // gentle wind sway
        this.tweens.add({
            targets: g,
            angle: { from: -2, to: 2 },
            duration: 1400 + Math.random() * 1200,
            yoyo: true,
            repeat: -1,
            ease: 'Sine.easeInOut',
            delay: Math.random() * 800,
        });
        this.decorations.add(g);
    }

    private createShrine() {
        const cx = WORLD_W / 2;
        const cy = WORLD_H / 2;
        const g = this.add.graphics();

        // tiered stone pedestal
        g.fillStyle(0x5a5a5a, 1);
        g.fillEllipse(cx, cy + 30, 200, 110);
        g.fillStyle(0x6e6e6e, 1);
        g.fillEllipse(cx, cy + 18, 160, 88);
        g.fillStyle(0x808080, 1);
        g.fillEllipse(cx, cy + 6, 120, 66);
        g.fillStyle(0x939393, 1);
        g.fillEllipse(cx, cy - 4, 84, 46);

        // carved sun symbol engraving on top tier
        g.lineStyle(3, 0xe5a93b, 0.9);
        g.strokeCircle(cx, cy - 4, 26);
        for (let i = 0; i < 12; i++) {
            const a = (i / 12) * Math.PI * 2;
            g.lineBetween(cx + Math.cos(a) * 30, cy - 4 + Math.sin(a) * 30,
                cx + Math.cos(a) * 40, cy - 4 + Math.sin(a) * 40);
        }

        // surrounding carved megaliths
        for (let i = 0; i < 6; i++) {
            const a = (i / 6) * Math.PI * 2;
            const sx = cx + Math.cos(a) * 150;
            const sy = cy + Math.sin(a) * 95;
            this.drawStandingStone(sx, sy);
        }

        // central brazier bowl
        g.fillStyle(0x3a2414, 1);
        g.fillRect(cx - 16, cy - 26, 32, 10);
        g.fillStyle(0x5c3317, 1);
        g.fillTriangle(cx - 14, cy - 16, cx + 14, cy - 16, cx, cy - 4);

        g.setDepth(-1);
        this.decorations.add(g);

        // glowing brazier flame + ember particles
        const flame = this.add.graphics();
        flame.fillStyle(0xff8c1a, 0.9);
        flame.fillEllipse(cx, cy - 34, 22, 34);
        flame.fillStyle(0xffd24b, 0.95);
        flame.fillEllipse(cx, cy - 36, 12, 22);
        flame.fillStyle(0xffffff, 0.8);
        flame.fillEllipse(cx, cy - 38, 5, 10);
        flame.setDepth(2);
        this.tweens.add({
            targets: flame,
            scaleY: { from: 1, to: 1.25 },
            scaleX: { from: 1, to: 0.92 },
            duration: 320,
            yoyo: true,
            repeat: -1,
            ease: 'Sine.easeInOut',
        });

        // warm ambient light halo
        const halo = this.add.graphics();
        halo.fillStyle(0xff8c1a, 0.12);
        halo.fillCircle(cx, cy - 30, 70);
        halo.setDepth(1);
        this.tweens.add({ targets: halo, alpha: { from: 0.6, to: 1 }, duration: 900, yoyo: true, repeat: -1 });

        // ember particle emitter
        this.emberEmitter = this.add.particles(cx, cy - 40, 'spark', {
            speed: { min: 10, max: 50 },
            angle: { min: 250, max: 290 },
            lifespan: { min: 600, max: 1400 },
            scale: { start: 0.5, end: 0 },
            alpha: { start: 1, end: 0 },
            quantity: 1,
            frequency: 90,
            tint: [0xff8c1a, 0xffd24b],
        });
        this.emberEmitter.setDepth(3);
    }

    private createAmbientMotes() {
        this.pollenEmitter = this.add.particles(0, 0, 'glow', {
            x: { min: 0, max: WORLD_W },
            y: { min: 0, max: WORLD_H },
            speed: { min: 4, max: 16 },
            lifespan: { min: 4000, max: 8000 },
            scale: { start: 0.25, end: 0 },
            alpha: { start: 0.5, end: 0 },
            quantity: 1,
            frequency: 220,
            tint: [0xfff2c0, 0xffe08a],
        });
        this.pollenEmitter.setDepth(4);
    }

    private createPlayer() {
        // --- PROCEDURAL AFRICAN EXPLORER: 4 directions x 4 stride frames ---
        // Build a spritesheet texture by drawing each frame into a canvas texture.
        const totalFrames = 16;
        const sheetW = FRAME_W * totalFrames;
        const sheetH = FRAME_H;
        const canvas = this.textures.createCanvas('player_sheet', sheetW, sheetH)!;
        const ctx = canvas.getContext()!;

        const skin = '#6b4226';
        const skinShade = '#553319';
        const tunic = '#b44c1d';
        const tunicPattern = '#e5a93b';
        const sash = '#85441d';
        const bead = '#f4e3b2';
        const boot = '#3a2414';
        const hair = '#241812';

        const drawFrame = (idx: number, dir: Facing, step: number) => {
            const ox = idx * FRAME_W;
            const cx = ox + FRAME_W / 2;
            const groundY = FRAME_H - 6;
            // stride offsets
            const legSwing = [0, 3, 0, -3][step];
            const bodyBob = [0, -1, 0, -1][step];
            const armSwing = [0, 2, 0, -2][step];
            const cy = groundY - 34 + bodyBob; // torso center

            // shadow
            ctx.fillStyle = 'rgba(0,0,0,0.22)';
            ctx.beginPath();
            ctx.ellipse(cx, groundY, 12, 4, 0, 0, Math.PI * 2);
            ctx.fill();

            // legs + leather boots
            ctx.fillStyle = skinShade;
            ctx.fillRect(cx - 6, cy + 14, 5, 12 + legSwing);
            ctx.fillRect(cx + 1, cy + 14, 5, 12 - legSwing);
            ctx.fillStyle = boot;
            ctx.fillRect(cx - 7, cy + 24 + legSwing, 7, 4);
            ctx.fillRect(cx + 0, cy + 24 - legSwing, 7, 4);

            // patterned earth/gold tunic (torso)
            ctx.fillStyle = tunic;
            ctx.beginPath();
            ctx.roundRect(cx - 9, cy - 6, 18, 22, 4);
            ctx.fill();
            // geometric gold pattern stripes
            ctx.fillStyle = tunicPattern;
            ctx.fillRect(cx - 9, cy - 2, 18, 2);
            ctx.fillRect(cx - 9, cy + 6, 18, 2);
            ctx.fillRect(cx - 3, cy - 6, 2, 22);
            // sash across chest
            ctx.strokeStyle = sash;
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.moveTo(cx - 9, cy + 12);
            ctx.lineTo(cx + 9, cy - 4);
            ctx.stroke();

            // beaded necklace
            ctx.fillStyle = bead;
            for (let b = -2; b <= 2; b++) {
                ctx.beginPath();
                ctx.arc(cx + b * 3, cy - 5, 1.4, 0, Math.PI * 2);
                ctx.fill();
            }

            // arms
            ctx.fillStyle = skin;
            if (dir === 'left') {
                ctx.fillRect(cx - 12, cy - 2 + armSwing, 4, 12);
            } else if (dir === 'right') {
                ctx.fillRect(cx + 8, cy - 2 - armSwing, 4, 12);
            } else {
                ctx.fillRect(cx - 12, cy - 2 + armSwing, 4, 12);
                ctx.fillRect(cx + 8, cy - 2 - armSwing, 4, 12);
            }

            // head + warm skin
            ctx.fillStyle = skin;
            ctx.beginPath();
            ctx.arc(cx, cy - 14, 8, 0, Math.PI * 2);
            ctx.fill();

            // headwrap / stylized hair with gold band
            ctx.fillStyle = hair;
            ctx.beginPath();
            ctx.arc(cx, cy - 16, 8, Math.PI, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = tunicPattern;
            ctx.fillRect(cx - 8, cy - 17, 16, 3);

            // face / eyes by direction
            ctx.fillStyle = '#1a130e';
            if (dir === 'down') {
                ctx.beginPath(); ctx.arc(cx - 3, cy - 13, 1.2, 0, Math.PI * 2); ctx.fill();
                ctx.beginPath(); ctx.arc(cx + 3, cy - 13, 1.2, 0, Math.PI * 2); ctx.fill();
            } else if (dir === 'left') {
                ctx.beginPath(); ctx.arc(cx - 4, cy - 13, 1.2, 0, Math.PI * 2); ctx.fill();
            } else if (dir === 'right') {
                ctx.beginPath(); ctx.arc(cx + 4, cy - 13, 1.2, 0, Math.PI * 2); ctx.fill();
            }
            // up: no eyes (back of head)
        };

        const dirs: Facing[] = ['down', 'up', 'left', 'right'];
        let idx = 0;
        for (const dir of dirs) {
            for (let step = 0; step < 4; step++) {
                drawFrame(idx, dir, step);
                idx++;
            }
        }
        canvas.refresh();

        // Register the 16 sub-frames on the canvas texture so
        // generateFrameNumbers() and sprite frame slicing resolve valid
        // frame data (without this, anims.play() crashes because
        // currentFrame is undefined and .duration access throws).
        for (let i = 0; i < totalFrames; i++) {
            if (!canvas.has(String(i))) {
                canvas.add(i, 0, i * FRAME_W, 0, FRAME_W, FRAME_H);
            }
        }

        // Register walk animations per direction
        for (let d = 0; d < dirs.length; d++) {
            const dir = dirs[d];
            const key = this.animKey(dir);
            if (!this.anims.exists(key)) {
                this.anims.create({
                    key,
                    frames: this.anims.generateFrameNumbers('player_sheet', {
                        start: d * 4,
                        end: d * 4 + 3,
                    }),
                    frameRate: 10,
                    repeat: -1,
                });
            }
        }

        // Create physics sprite
        const save = loadSave();
        this.player = this.physics.add.sprite(
            save.lastPosition.x || 200,
            save.lastPosition.y || 200,
            'player_sheet',
            this.frameIndex('down', 0)
        );
        this.player.setCollideWorldBounds(true);
        this.player.setDepth(10);
        this.player.setDrag(PLAYER_FRICTION, PLAYER_FRICTION);
        this.player.setMaxVelocity(PLAYER_SPEED, PLAYER_SPEED);
        (this.player.body as Phaser.Physics.Arcade.Body).setCircle(12, 12, 30);

        // footstep dust emitter (hidden pool, emitted on steps)
        this.dustEmitter = this.add.particles(0, 0, 'dust', {
            speed: { min: 6, max: 26 },
            angle: { min: 200, max: 340 },
            lifespan: { min: 250, max: 550 },
            scale: { start: 0.5, end: 0 },
            alpha: { start: 0.55, end: 0 },
            tint: [0xd9b382, 0xc4903a],
            emitting: false,
        });
        this.dustEmitter.setDepth(8);

        // Colliders
        this.physics.add.collider(this.player, this.groundBodies);
    }
}

export default StartGame;