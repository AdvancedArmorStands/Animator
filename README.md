# AS Animator (Armor Stand Animator)

**AS Animator** is a powerful web-based 3D pose and timeline editor designed for Minecraft's **AdvancedArmorStands** plugin. It allows you to visually pose armor stand parts, build step-by-step keyframe animations, scrub timeline playback in real-time, and seamlessly import or export ready-to-use `animations.yml` configuration files.

---

## Features

- **Interactive 3D Viewport**: Live 3D rendering with Three.js featuring orbit controls, camera locking, grid toggling, and realistic armor stand geometry.
- **Keyframe & Timeline Scrubbing**:
  - Step-by-step keyframe posing.
  - Interactive playhead scrubbing and duration readouts.
  - Track reordering and individual track lock/hide controls.
  - Multi-select keyframe marquee box selection.
- **Pose Controls**: Drag-to-scrub or precise numeric inputs for X, Y, and Z rotations on all armor stand body parts (head, left arm, right arm, left leg, right leg).
- **Advanced Features**:
  - Full support for `animations.yml` format including step intervals, looping, and smooth interpolation settings.
  - Command palette search triggered via `Ctrl + K` or `Cmd + K` with calculation utilities and quick command execution.
  - Local browser project persistence and YAML code export / copy options.
  - Dark-mode professional desktop interface.

---

## Tech Stack

- **Framework**: [React 19](https://react.dev/)
- **3D Graphics**: [Three.js](https://threejs.org/)
- **Build Tool**: [Vite 8](https://vitejs.dev/)
- **Icons**: [Lucide React](https://lucide.dev/)
- **Linter**: [Oxlint](https://oxc.rs/)

---

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) (v18+ recommended)
- `npm` (comes with Node.js)

### Installation

1. Clone the repository:
   ```bash
   git clone <repository-url>
   cd armor-stand-animator
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

### Development Scripts

- **Start Dev Server**:
  ```bash
  npm run dev
  ```
- **Build Production Bundle**:
  ```bash
  npm run build
  ```
- **Preview Production Build**:
  ```bash
  npm run preview
  ```
- **Run Linter**:
  ```bash
  npm run lint
  ```

---

## License

Copyright (c) 2025 AS Animator / Armor Stand Animator. All Rights Reserved.

This project is protected under a strict proprietary license. **No copying, redistribution, modification, sublicensing, or commercial use is permitted in any form or by any means without explicit prior written permission from the copyright holder.**

See the full terms in the [LICENSE](./LICENSE) file.
