# mohammedabdullah-fn.github.io

Portfolio of **Mohammed Abdullah**: mechanical engineer, M.S. Mechatronics, Robotics & Automation at Northeastern, Certified SOLIDWORKS Professional (CSWP).

Three versions, three robots:

| Path | Version | Robot | Idea |
| --- | --- | --- | --- |
| `/` | 01 Workcell | 5-axis articulated arm | Cinematic WebGL workcell. The arm tracks the cursor with closed-form IK; drag it onto a card to open it, pick and place parts, run a robot program, open the teach pendant and exploded view. |
| `/terrain/` | 02 Terrain Lab | Mecanum-wheel rover | Drive a Mecabot-style rover across tile, hardwood, carpet and grass with a live IMU trace and a classifier that follows the EECE 5554 project's confusion matrix. |
| `/blueprint/` | 03 Blueprint | Quadruped | An engineering drawing set that comes alive: a line-art quadruped walks the sheets, dimensions draw themselves, and the ME 5374 elbow actuator explodes on scroll. |

## Run locally

Any static server works. From this folder:

```bash
python -m http.server 5173
```

Then open http://localhost:5173/. Opening `index.html` straight from disk won't work, because ES modules need a server.

## Deploy (GitHub Pages)

1. Create a public repository named **`mohammedabdullah-fn.github.io`** on GitHub.
2. Push this folder to its `main` branch.
3. In the repository's *Settings → Pages*, set the source to *Deploy from a branch → main / (root)*.

The site goes live at https://mohammedabdullah-fn.github.io/ within a minute or two.

## Editing content

- **01 Workcell:** page text is in `index.html` (cards near the top, full sections inside `#modal`). Scene code is in `assets/js/`:
  - `arm.js`: robot geometry, IK, servos
  - `motion.js`: MoveJ/MoveL programs
  - `main.js`: scene and interaction
  - `holo.js`: hologram models
  - `room.js`: room and follow-spot
  - `ui.js`: sheets, toasts, haptics
- **Images:** `assets/img/` (EXIF stripped). **Resume:** `resume.pdf`.
- **Link previews:** `assets/og/*.jpg` (1200x630), referenced by absolute `og:image` URLs. Give a changed image a new file name so LinkedIn fetches it again.
- **Search:** `robots.txt`, `sitemap.xml` and a custom `404.html` live at the root.

## Notes

- Add `?debug` to the URL to expose test hooks (`window.__ma` on 01).
- With *prefers-reduced-motion* on, ambient camera motion and film grain are turned off. The robots still respond to input.
