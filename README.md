# Uno Biofeedback Drift

A 3D autonomous racing and biofeedback training game built with WebGPU. Based on the Fiat Uno Mille EP ("Uno com Escada"), featuring guided biofeedback drift mechanics and multi-tier graphics quality modes.

## Features
- **Autonomous Driving**: The vehicle accelerates, brakes, and steers along the track automatically.
- **Guided Biofeedback Contraction Drift**:
  - `RELAX`: Cruise along straightaways with relaxed muscles.
  - `CONTRACT`: Hold Spacebar (or mouse click / touch) when approaching curves to engage locked-in guided drifting around apexes.
- **Minimalist HUD**: Real-time biofeedback status banner, contraction meter, speedometer, and lap timer.
- **Quality Modes**:
  - **Low**: 960x540 with lightweight shadow maps, optimized for lower-end hardware and integrated GPUs.
  - **Medium**: 1280x720 balanced visuals and smooth 60 FPS.
  - **High**: 1920x1080 full resolution and dynamic reflections.
  - Press `Q` or click the Quality button to cycle modes.

## Controls
- **Spacebar / Left Click / Touch**: Muscle Contraction (Guided Drift)
- **Release**: Relax (Straights)
- **Q**: Cycle Quality (Low / Medium / High)
- **C**: Switch Camera
- **R**: Reset car position
- **H**: Toggle Controls help

## Building
To recompile `index.html` from the modular source:
```bash
python source/build.py index.html
```
