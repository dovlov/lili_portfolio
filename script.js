/* ============================================================================
 * lili_portfolio — draggable image physics + click-to-expand
 * ============================================================================
 *
 * A direct port of the model in phydemo.app/balls-simulation (ricktu288),
 * with circles swapped for axis-aligned rectangles (your images).
 *
 * The five rules taken from that demo's RenderScene.js:
 *
 *   1. THE WALLS ARE READ FRESH EVERY FRAME.
 *      The original tests `x > canvas.width - r` inside the physics loop, so
 *      the world is simply whatever size it is this instant. There is no
 *      "resize handler" — a resized window is just a different number next
 *      tick. Same here: WORLD.w / WORLD.h are re-read at the top of every frame.
 *
 *   2. A WALL HIT IS TWO OPERATIONS, NOT ONE.
 *          this.x[i]  =  canvas.width - this.r     // hard positional clamp
 *          this.Vx[i] = -this.Vx[i] * this.vd      // reflect, losing energy
 *      The clamp prevents penetration; the reflection is what you feel.
 *
 *   3. SUBSTEPPING.
 *      The demo runs 10 integration steps per rendered frame at a fixed
 *      DeltaT = 0.1. Small steps mean nothing tunnels through a wall or
 *      through another body, and stacks stay calm.
 *
 *   4. DAMPING IS A PER-STEP MULTIPLICATIVE BLEED, NOT A TIMED EASING.
 *          this.Vx[i] -= this.Vx[i] * this.air_res
 *
 *   5. DRAGGING STEERS VELOCITY — IT DOES NOT SET POSITION.
 *          this.Vx[touched] = -0.5 * (x - touch_x) / DeltaT / 10
 *      i.e. velocity = k * (target - body). The body *chases* its target as a
 *      normal physics body, so it still collides on the way, and a throw needs
 *      no special code.
 *
 *      This is also the whole trick behind click-to-expand: a click just
 *      swaps the pointer for the centre of the window as the chase target.
 *      The image flies to the middle as a real, solid, infinitely-heavy body,
 *      barging everything else out of its path — no separate tween, no
 *      "animation mode" that physics has to be suspended for.
 *
 * Units: velocity is px per 60fps-frame; acceleration is px per frame².
 * ========================================================================== */

/* ============================================================================
 * 1. YOUR IMAGES  ←— this is the only part you need to edit
 * ==========================================================================
 * Drop an image file into this folder, then add it to this list. Each entry
 * appears exactly once. png / jpg / webp / gif / svg all work.
 *
 * Two ways to write an entry:
 *   "filename.webp"                          — no hover tooltip
 *   { src: "filename.webp", label: "TITLE" }  — hovering the thumbnail shows
 *                                                a tooltip reading TITLE
 *
 * Want a tooltip that looks different from the rest (bigger text, a tighter
 * fade, different padding) for just ONE image? Add a `tooltip` object — any
 * field you include there overrides that same field in CONFIG.tooltip below,
 * for this image only:
 *
 *   { src: "big-piece.webp", label: "THE BIG PIECE",
 *     tooltip: { fontSize: 32, padH: 12 } }
 *
 * (You can also just drag image files onto the page to try them out, but
 * those are temporary and vanish on reload — add them here to keep them.)
 */
const IMAGES = [
    { src: "slime_1.webp", label: "SLIME COLLECTIVE" },
    { src: "slime_2.webp", label: "THE SLIME MOLD HOLD" },
];

/* ============================================================================
 * 2. TUNING
 * ========================================================================== */
const CONFIG = {
    /* ---- Size & look ---- */
    minWidth: 150, // random width per image, in px…
    maxWidth: 300, // …height follows from the image's own aspect ratio
    strokeWidth: 4, // the 4pt black outline
    strokeColor: "#000000",

    /* ---- Small screens ----
       Read ONCE, at page load, and never again. See SPAWN_SCALE in section 4
       for why that matters. To preview the small-screen sizing on a desktop,
       narrow the window below the breakpoint and RELOAD — narrowing alone
       will (deliberately) do nothing. */
    mobileBreakpoint: 700, // px of window width at load…
    mobileSpawnScale: 0.5, // …under which images spawn at half their usual size

    /* ---- Motion (the demo's sliders) ---- */
    gravity: 0.5, // px/frame². Demo equivalent: g * tilt.y = 3 * 0.1
    wallBounce: 0.55, // the demo's `vd` (it ships 0.95 — bouncier)
    airResistance: 0.01, // the demo's `air_res`, applied per substep

    /* ---- Stacking ---- */
    bodyBounce: 0.2, // restitution between two images; low = calm piles
    friction: 0.24, // tangential friction at any contact
    groundFriction: 0.08, // extra horizontal drag while resting on the floor

    /* ---- Dragging ---- */
    chase: 0.6, // how hard a held image is pulled toward the cursor (rule 5)
    maxThrow: 55, // speed cap on release, px/frame
    resizeShove: 1, // how much of a closing wall's speed transfers to a body

    /* ---- Click to expand ---- */
    expandFraction: 0.6, // expanded size fits inside 60% of width AND height
    flightChase: 0.24, // chase gain on the trip to centre — lower = statelier
    flightMinSpeed: 1.5, // px/frame floor, so the approach never crawls
    flightTimeout: 150, // frames before arrival is forced (safety net)
    expandFrames: 20, // ≈330ms to scale up
    collapseFrames: 16, // ≈270ms to scale back down
    clickSlop: 6, // px of travel below which a press counts as a click
    clickTime: 450, // ms held below which a press counts as a click
    focusDelay: 600, // ms an incoming image waits for the outgoing one to clear

    /* ---- Solver ---- */
    substeps: 8, // integration steps per frame (demo: 10)
    solverPasses: 2, // collision passes per substep
    maxSpeed: 90, // hard speed clamp, px/frame
    restSpeed: 0.4, // below this at a contact, velocity is zeroed
    restitutionCutoff: 1.6, // slow contacts don't bounce (kills stack jitter)
    penetrationSlop: 0.5, // allowed overlap, px
    correction: 0.8, // fraction of penetration resolved per pass

    /* ---- Hover tooltip ----
       Per-image overrides: give an IMAGES entry a `tooltip: {...}` object
       (see section 1) with any of these same keys to change just that
       image's tooltip. Everything it doesn't mention still comes from here. */
    tooltip: {
        size: 50, // px — the blank square's side length, AND the box's
        //             height for the rest of the hover (only width animates)
        fadeMs: 300, // stage 1: opacity 0 → 1, at the fixed `size`
        growMs: 220, // stage 2: width animates from `size` out to hug the text,
        //              growing equally to the left and right of the cursor
        labelFadeMs: 200, // stage 3: the label fades in, once growing has STOPPED
        growEasing: "cubic-bezier(0.22, 1, 0.36, 1)", // a gentle overshoot-free ease-out
        padH: 8, // horizontal padding, px, EACH side (so text sits padH from both edges)
        // Vertical padding, px, each side. NOT independently animated or
        // enforced as literal CSS padding — the box's height is fixed at
        // `size` above (see the module header in section 8.5 for why), and
        // the text is centred inside it, which at the DEFAULT size/fontSize
        // works out to ~8px top and bottom. This value exists so the math is
        // documented; if you customize `fontSize` or `size` for one image,
        // adjust the other to keep ~8px of breathing room top and bottom.
        padV: 8,
        borderWidth: 2, // the 2pt stroke
        fill: "#ffffff",
        stroke: "#000000",
        textColor: "#000000",
        fontFamily: '"Roboto Condensed", "Arial Narrow", sans-serif',
        fontWeight: 700,
        fontSize: 26, // px
        letterSpacing: "normal",
        // The box is CENTRED on the cursor horizontally; this is the clear
        // space between the cursor and the box's top edge.
        cursorGap: 16,
        edgeMargin: 12, // never rendered closer than this to a window edge
    },
};

/** z-index band for the one expanded image. Everything else counts up from 1. */
const FOCUS_Z = 5000;

/* ============================================================================
 * 3. SMALL HELPERS
 * ========================================================================== */

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const rand = (lo, hi) => lo + Math.random() * (hi - lo);
const lerp = (a, b, t) => a + (b - a) * t;

/* Easing. Deliberately no overshoot — a bouncing lightbox reads as noisy;
   the physics is where the personality lives, the zoom should be calm. */
const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
const easeInOutCubic = (t) =>
    t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

/** One 60fps frame, in ms. All velocities are expressed per frame. */
const FRAME_MS = 1000 / 60;

/** Frame-delta clamp, so a backgrounded tab doesn't resume with a huge jump. */
const MIN_FRAME_SCALE = 0.25;
const MAX_FRAME_SCALE = 2;

/** Frames of stillness before the animation loop shuts itself off. */
const SLEEP_FRAMES = 45;

const stage = document.getElementById("stage");
const dropHint = document.getElementById("dropHint");

/** Honour the OS "reduce motion" setting: no gravity, no launch velocity. */
const reduceMotion =
    window.matchMedia &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/* ============================================================================
 * 4. WORLD STATE
 * ========================================================================== */

/** Every image in the simulation, in back-to-front paint order. */
const bodies = [];

/**
 * How big images spawn, relative to their usual random size. Phones get half
 * scale so a sensible number of images fit on a narrow screen.
 *
 * THE WHOLE POINT IS THAT THIS IS A CONSTANT, decided once from the window
 * width at load and then frozen for the session. Resizing must never resize
 * an image: dragging a desktop window narrow is something you do WITH the
 * toy — the walls close in and shove the pile around (see the resize shove in
 * step()) — and having the pieces silently change size mid-play would break
 * that. A phone gets small images because it was a phone when it loaded, not
 * because the window is narrow right now.
 *
 * This is the only thing that reads the breakpoint, and `addBody` is the only
 * thing that reads this. An image's `w`/`h` are set once when it is built and
 * never written again, so there is no path by which a later resize could
 * reach back and change one.
 */
const SPAWN_SCALE =
    window.innerWidth < CONFIG.mobileBreakpoint ? CONFIG.mobileSpawnScale : 1;

/**
 * The walls. Re-read from the window every frame (rule 1). `prevW/prevH` let
 * us work out how fast a wall is moving during a live resize.
 */
const WORLD = { w: 0, h: 0, prevW: 0, prevH: 0 };

/** Raised each time you grab something, so the touched image comes to the front. */
let zCounter = 1;

/** The one image currently flying / expanded / collapsing, or null. */
let focused = null;

/** An image clicked while another was open, waiting its turn. See focusBody(). */
let pendingFocus = null;
let pendingAt = 0; // performance.now() timestamp at which it sets off

/** Loop bookkeeping. */
let rafId = null;
let lastTime = null;
let idleFrames = 0;
/** Suppresses the resize-shove on the first frame after waking (stale delta). */
let skipShove = true;

/* ---------------------------------------------------------------------------
 * Body modes
 * -------------------------------------------------------------------------
 *   free        normal physics — falls, bounces, collides
 *   grabbed     under the pointer (rule 5 chase)
 *   flying      auto-chasing the centre of the window after a click
 *   expanding   parked at centre, scaling up
 *   expanded    parked at centre at full size
 *   collapsing  parked at centre, scaling back down
 *
 * `driven` bodies are steered by a target instead of by gravity, and act as
 * infinitely heavy in collisions — so they shove and are never shoved.
 * `solid` bodies take part in collisions and wall hits at all. An expanded
 * image is deliberately NOT solid: it floats above the scene rather than
 * bulldozing the pile while it is being looked at.
 * ------------------------------------------------------------------------- */

const isDriven = (b) => b.mode === "grabbed" || b.mode === "flying";
const isSolid = (b) =>
    b.mode === "free" || b.mode === "grabbed" || b.mode === "flying";
const isBusy = (b) =>
    b.mode === "flying" || b.mode === "expanding" || b.mode === "collapsing";

/* ============================================================================
 * 5. BUILDING A STICKER
 * ==========================================================================
 * The outline is BAKED ONCE into a canvas rather than applied as a live CSS
 * filter. Two reasons:
 *   - It follows the image's actual alpha silhouette, so a cut-out shape gets
 *     a real 4px outline around the shape (an opaque photo just gets a 4px
 *     rectangular border, which is the same thing).
 *   - It costs nothing per frame. A stacked `drop-shadow()` filter would be
 *     re-composited on every transform, on every body, forever.
 *
 * A body carries up to two bakes: `base` (thumbnail) and `big` (expanded).
 * The outline is PROPORTIONAL — the expanded bake uses a stroke of
 * `strokeWidth × zoom`, so an expanded image looks like the thumbnail zoomed
 * rather than a big image wearing a thin wire. That also makes the two bakes
 * geometrically identical at every moment of the zoom: they differ only in
 * resolution, so swapping between them is invisible. (An earlier version kept
 * the stroke pinned at 4px, which forced a visible seam somewhere in the
 * animation — proportional removes the problem rather than hiding it.)
 */

/**
 * Draw `img` into a new canvas at w×h with a `stroke`px outline around it.
 * Technique: stamp the image repeatedly around a circle of radius `stroke`,
 * flatten all of those to solid black with `source-in`, then draw the real
 * image on top.
 */
function bakeSticker(img, w, h, stroke, color) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const pad = stroke;
    const cw = w + pad * 2; // the canvas is bigger than the image by the
    const ch = h + pad * 2; // outline on each side

    /* Stamps around the ring. The count has to grow with the radius or a thick
       outline comes out scalloped: neighbouring stamps must land about a pixel
       apart along the ring, so steps ≈ circumference. */
    const steps = clamp(Math.ceil(2 * Math.PI * stroke), 20, 128);

    const canvas = document.createElement("canvas");
    canvas.width = Math.round(cw * dpr);
    canvas.height = Math.round(ch * dpr);
    canvas.style.width = cw + "px";
    canvas.style.height = ch + "px";

    const ctx = canvas.getContext("2d");
    ctx.scale(dpr, dpr);
    ctx.imageSmoothingQuality = "high";

    // --- The outline ---
    ctx.save();
    for (let i = 0; i < steps; i++) {
        const a = (i / steps) * Math.PI * 2;
        ctx.drawImage(
            img,
            pad + Math.cos(a) * stroke,
            pad + Math.sin(a) * stroke,
            w,
            h
        );
    }
    // Everything drawn so far is a fat silhouette; flood it with solid black.
    ctx.globalCompositeOperation = "source-in";
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, cw, ch);
    ctx.restore(); // restore() also resets globalCompositeOperation

    // --- The image itself, centred in the padding ---
    ctx.drawImage(img, pad, pad, w, h);

    return { canvas, ctx, width: cw, height: ch, dpr };
}

/** Load one image file and return a decoded HTMLImageElement. */
function loadImage(src) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error("Could not load " + src));
        img.src = src;
    });
}

/**
 * The expanded size for a body: the largest box with the image's aspect ratio
 * that fits inside `expandFraction` of BOTH the window width and height.
 *
 * Fitting to whichever limit is hit first is the whole point — a tall image
 * is capped by height, a wide one by width, and neither is ever cropped or
 * squashed. Stroke padding is included so the *visible* object honours 60%.
 */
function expandedSize(body) {
    /* Because the stroke scales too, the expanded object is just the thumbnail
       object multiplied by a single zoom factor. So the fit is one number:
       whichever of the two 60% limits is reached first wins, and nothing is
       ever cropped or squashed. */
    const zoom = Math.min(
        (WORLD.w * CONFIG.expandFraction) / body.w,
        (WORLD.h * CONFIG.expandFraction) / body.h
    );
    const stroke = Math.max(1, CONFIG.strokeWidth * zoom);
    const imgW = Math.max(8, Math.round(body.baseImgW * zoom));
    const imgH = Math.max(8, Math.round(body.baseImgH * zoom));

    return {
        zoom,
        stroke,
        imgW,
        imgH,
        w: imgW + stroke * 2, // outer size, matching the baked canvas
        h: imgH + stroke * 2,
    };
}

/** Put a canvas into the DOM in place of the body's current element. */
function mountCanvas(body, baked, kind) {
    const old = body.el;
    const next = baked.canvas;

    next.className = old ? old.className : "sticker";
    next.style.zIndex = old ? old.style.zIndex : String(zCounter++);

    if (old && old.parentNode) old.parentNode.replaceChild(next, old);
    else stage.appendChild(next);

    body.el = next;
    body.ctx = baked.ctx;
    body.dpr = baked.dpr;
    body.mountedW = baked.width;
    body.mountedH = baked.height;
    body.mounted = kind;

    /* Position the new canvas BEFORE the browser gets a chance to paint it.
       A freshly created canvas has no transform of its own, so leaving this to
       the next render() would flash it, unscaled, at the top-left corner. */
    body.lastTransform = null;
    writeTransform(body);
}

/**
 * Put one body's canvas where it belongs.
 *
 * The mounted canvas is drawn CENTRED on the physics box and multiplied by
 * `scale`, so a growing image expands about its own middle instead of its
 * top-left corner. For an unexpanded body the mounted size equals the physics
 * size and the scale is 1, so this reduces to a plain translate.
 */
function writeTransform(body) {
    const cx = body.x + body.w / 2;
    const cy = body.y + body.h / 2;
    const tx = Math.round((cx - body.mountedW / 2) * 10) / 10;
    const ty = Math.round((cy - body.mountedH / 2) * 10) / 10;
    const s = Math.round(body.scale * 1e4) / 1e4;

    const transform =
        s === 1
            ? "translate3d(" + tx + "px," + ty + "px,0)"
            : "translate3d(" + tx + "px," + ty + "px,0) scale(" + s + ")";

    if (transform === body.lastTransform) return; // no-op skip
    body.lastTransform = transform;
    body.el.style.transform = transform;
}

/**
 * Turn a loaded image into a physics body and put it somewhere random.
 * Width is random within CONFIG; height comes from the natural aspect ratio,
 * so the image is never distorted.
 */
function addBody(img, opts) {
    /* SPAWN_SCALE is the small-screen halving (section 4) — a session-long
       constant, so images added later by drag-and-drop match the ones that
       loaded with the page. The stroke is deliberately NOT scaled with it:
       every thumbnail wears the same 4px outline regardless of how big it is,
       on any screen. (Halve CONFIG.strokeWidth if you'd rather it read
       lighter on phones.) */
    const targetW = Math.round(
        rand(CONFIG.minWidth, CONFIG.maxWidth) * SPAWN_SCALE
    );
    const ratio = img.naturalHeight / img.naturalWidth || 1;
    const targetH = Math.round(targetW * ratio);

    const body = {
        img, // kept for re-baking at expanded size
        ratio,

        /* Hover tooltip. `label` of null means this image just has no
           tooltip. `tooltipCfg` is CONFIG.tooltip with this image's own
           `tooltip: {...}` overrides (if any) merged on top — see section 1.
           `tooltipWidth` is filled in lazily, on the first hover, by
           measureTooltipWidth(): most images are never hovered in a given
           visit, so there is no reason to pay for a DOM measurement at
           load time for every single one. */
        label: (opts && opts.label) || null,
        tooltipCfg:
            opts && opts.label
                ? Object.assign({}, CONFIG.tooltip, opts.tooltip || {})
                : null,
        tooltipWidth: null,
        el: null,
        ctx: null,
        dpr: 1,

        /* Physics box — always the THUMBNAIL size, even while expanded. The
           expanded image is not solid, so its collision box never matters;
           keeping it constant means collapsing needs no re-measurement. */
        w: targetW + CONFIG.strokeWidth * 2,
        h: targetH + CONFIG.strokeWidth * 2,
        baseImgW: targetW,
        baseImgH: targetH,

        x: 0,
        y: 0,
        vx: 0,
        vy: 0,

        /* Rendering: the mounted canvas is drawn centred on the physics box
           and multiplied by `scale`, so growth happens about the centre. */
        mounted: "base",
        mountedW: 0,
        mountedH: 0,
        scale: 1,
        baseBake: null,
        bigBake: null,
        rebakeAt: 0,

        mode: "free",
        t: 0, // 0→1 progress through expand / collapse
        fromScale: 1,
        toScale: 1,
        flightFrames: 0,
        prevZ: 1,

        pointerId: null,
        grabDX: 0,
        grabDY: 0,
        targetX: 0,
        targetY: 0,

        contact: false,
        onGround: false,
        lastTransform: null,
    };

    /* Heavier images shove lighter ones around. Area-proportional mass,
       normalised so a ~200×200 sticker weighs about 1. */
    body.mass = (body.w * body.h) / 40000;
    body.invMass = 1 / body.mass;

    body.baseBake = bakeSticker(
        img,
        targetW,
        targetH,
        CONFIG.strokeWidth,
        CONFIG.strokeColor
    );
    scatter(body); // position first, so the canvas is never mounted at 0,0
    mountCanvas(body, body.baseBake, "base");

    bodies.push(body);
    wake();
    return body;
}

/**
 * Drop a body at a random spot, trying a few times to avoid landing on top of
 * something already there. (The demo does the same with its `check()`.)
 */
function scatter(body) {
    const maxX = Math.max(0, WORLD.w - body.w);
    const maxY = Math.max(0, WORLD.h - body.h);

    for (let attempt = 0; attempt < 30; attempt++) {
        body.x = rand(0, maxX);
        body.y = rand(0, maxY * 0.6); // bias upward so there's room to fall
        if (!overlapsAny(body)) break;
    }

    // A small random nudge, like the demo's `Vx = -10 + 10 * Math.random()`.
    body.vx = reduceMotion ? 0 : rand(-3, 3);
    body.vy = reduceMotion ? 0 : rand(-1, 2);
}

function overlapsAny(body) {
    for (const other of bodies) {
        if (other === body) continue;
        if (
            body.x < other.x + other.w &&
            body.x + body.w > other.x &&
            body.y < other.y + other.h &&
            body.y + body.h > other.y
        )
            return true;
    }
    return false;
}

/* ============================================================================
 * 6. CLICK TO EXPAND
 * ==========================================================================
 * The four-stage sequence, matching the brief:
 *
 *   click ──▶ flying     the image chases the centre of the window as a solid,
 *                        infinitely-heavy body, shoving whatever it passes
 *                        through out of the way
 *          ──▶ expanding on arrival its z-index jumps above everything, it
 *                        leaves the collision set, and it scales up to fit
 *                        60% of the window
 *          ──▶ expanded  parked, centred, on top
 *   click ──▶ collapsing scales back to thumbnail size at the centre
 *          ──▶ free      z-index returns to the normal band, collisions come
 *                        back on, and gravity drops it onto the pile
 */

/**
 * Stand an image down from being the focused one, whatever stage it's at.
 * A flight that never arrived is simply abandoned — the image becomes an
 * ordinary body again and falls from wherever it had got to.
 */
function releaseFocus(body) {
    if (body.mode === "flying") {
        body.mode = "free";
        body.el.classList.remove("is-busy");
        if (focused === body) focused = null;
    } else if (body.mode === "expanding" || body.mode === "expanded") {
        collapseBody(body);
    }
}

/**
 * Handle a click on a thumbnail.
 *
 * If another image is currently open, the incoming one WAITS before setting
 * off. Without the pause the outgoing image is still shrinking through the
 * middle of the screen while the incoming one arrives there, and the two meet
 * in a scrappy little collision at dead centre. `focusDelay` gives the
 * outgoing image time to finish collapsing and start falling clear, so the two
 * movements read as a sequence rather than a scuffle.
 */
function focusBody(body) {
    /* The one thing other than the cursor leaving that ends a tooltip: this
       image is no longer a thumbnail in the pile, it's on its way to the
       centre to be looked at properly. */
    if (hoveredBody === body) hideTooltip();

    const handingOver = focused && focused !== body;
    if (handingOver) releaseFocus(focused);

    if (handingOver) {
        pendingFocus = body;
        // Keep any deadline already running, so rapid clicking can't stack up
        // delays and leave the page looking frozen.
        if (!pendingAt) pendingAt = performance.now() + CONFIG.focusDelay;
        wake();
        return;
    }

    startFlight(body);
}

/** Actually send a body to the centre of the window. */
function startFlight(body) {
    pendingFocus = null;
    pendingAt = 0;

    focused = body;
    body.mode = "flying";
    body.flightFrames = 0;
    body.el.classList.add("is-busy");

    // Front of the paint order, so hit-testing finds it first from now on.
    bodies.splice(bodies.indexOf(body), 1);
    bodies.push(body);

    /* Bake the expanded bitmap NOW rather than on arrival. It costs a few ms,
       and a dropped frame at the very start of the flight is invisible where
       one at the moment the zoom begins would not be. */
    ensureBigBake(body);

    wake();
}

/**
 * Arrival at the centre. This is where the z-index changes, per the brief:
 * not on click, but at the moment the image's centre reaches the middle.
 */
function beginExpand(body) {
    const cx = WORLD.w / 2;
    const cy = WORLD.h / 2;

    body.x = cx - body.w / 2; // snap out any sub-pixel chase residue
    body.y = cy - body.h / 2;
    body.vx = 0;
    body.vy = 0;

    body.prevZ = body.el.style.zIndex;

    body.mode = "expanding";
    body.t = 0;

    /* ORDER MATTERS HERE.
       mountBig() swaps in a canvas whose CSS size is the full expanded size,
       so `scale` has to be dialled back to thumbnail-equivalent BEFORE the
       swap. Setting fromScale alone (and leaving body.scale at its old value
       of 1) is what put a full-size frame on screen for a beat before the zoom
       began: the new canvas was mounted, painted once at scale 1, and only
       corrected on the following frame. */
    body.fromScale = 1; // filled in properly right after the swap
    body.toScale = 1;
    mountBig(body);
    body.fromScale = body.w / body.mountedW; // start visually identical…
    body.scale = body.fromScale; // ← the fix: apply it immediately
    writeTransform(body); // …and put it on screen before any paint

    body.el.style.zIndex = String(FOCUS_Z); // ← now above every other image
    body.el.classList.add("is-focused");
}

/** Bake the expanded bitmap if it's missing or the window has changed size. */
function ensureBigBake(body) {
    const fit = expandedSize(body);
    if (!body.bigBake || Math.abs(body.bigBake.width - fit.w) > 1) {
        body.bigBake = bakeSticker(
            body.img,
            fit.imgW,
            fit.imgH,
            fit.stroke, // ← proportional: the outline zooms with the image
            CONFIG.strokeColor
        );
    }
    return body.bigBake;
}

/** Swap in the canvas baked at the expanded size. */
function mountBig(body) {
    mountCanvas(body, ensureBigBake(body), "big");
}

/** Start shrinking back. Called by a second click, Escape, or a background click. */
function collapseBody(body) {
    if (body.mode !== "expanded" && body.mode !== "expanding") return;
    body.mode = "collapsing";
    body.t = 0;
    body.fromScale = body.scale;
    body.toScale = body.w / body.mountedW; // back to thumbnail size on screen
    body.el.classList.remove("is-focused");
    body.el.classList.add("is-busy");

    /* Leave the focus z-band NOW, not when the shrink finishes. Clicking a
       second image starts that one's flight while this one is still
       shrinking; if both sat at FOCUS_Z, which drew on top would come down to
       DOM order. Dropping to the top of the normal band keeps this above the
       pile it is rejoining, and unambiguously below the new arrival. */
    body.el.style.zIndex = String(zCounter++);

    wake();
}

/** Shrink finished: back to a plain physics body, falling from the centre. */
function finishCollapse(body) {
    // scale first, THEN swap — mountCanvas positions the new canvas straight
    // away, so it has to be told the right scale before it does.
    body.scale = 1;
    mountCanvas(body, body.baseBake, "base");
    body.mode = "free";
    body.el.classList.remove("is-busy", "is-focused");
    // (z-index already returned to the normal band by collapseBody)

    body.vx = 0;
    body.vy = 0;

    // Free the expanded bitmap; it is re-baked on demand next time. Keeping
    // one per image would quietly cost tens of MB on an image-heavy page.
    body.bigBake = null;
    body.rebakeAt = 0;

    if (focused === body) focused = null;
    wake();
}

/** Per-frame update for whichever body is flying / expanding / collapsing. */
function updateFocus(body, frameScale, now) {
    const cx = WORLD.w / 2;
    const cy = WORLD.h / 2;

    switch (body.mode) {
        case "flying": {
            body.flightFrames += frameScale;
            /* Recompute the target here rather than trusting body.targetX —
               that field is written by the chase loop, and depending on a
               value another part of the frame is responsible for is exactly
               how a flight ends up being skipped. */
            const dx = cx - body.w / 2 - body.x;
            const dy = cy - body.h / 2 - body.y;
            const dist = Math.hypot(dx, dy);
            const speed = Math.hypot(body.vx, body.vy);
            if (
                (dist < 1.5 && speed < 2) ||
                body.flightFrames > CONFIG.flightTimeout
            ) {
                beginExpand(body);
            }
            break;
        }

        case "expanding":
        case "collapsing": {
            const frames =
                body.mode === "expanding"
                    ? CONFIG.expandFrames
                    : CONFIG.collapseFrames;
            body.t = Math.min(1, body.t + frameScale / frames);
            const eased =
                body.mode === "expanding"
                    ? easeOutCubic(body.t)
                    : easeInOutCubic(body.t);
            body.scale = lerp(body.fromScale, body.toScale, eased);

            // Stay pinned to the centre even if the window is being resized.
            body.x = cx - body.w / 2;
            body.y = cy - body.h / 2;

            if (body.t >= 1) {
                if (body.mode === "expanding") {
                    body.mode = "expanded";
                    body.scale = 1;
                    body.el.classList.remove("is-busy");
                } else {
                    finishCollapse(body);
                }
            }
            break;
        }

        case "expanded": {
            body.x = cx - body.w / 2;
            body.y = cy - body.h / 2;

            /* Resizing the window while an image is open: track the new 60%
               fit immediately with a cheap scale, then re-bake once the
               resize goes quiet so the outline returns to a true 4px.
               Re-baking on every resize frame would be far too slow. */
            const fit = expandedSize(body);
            if (Math.abs(fit.w - body.mountedW * body.scale) > 1) {
                body.scale = fit.w / body.mountedW;
                body.rebakeAt = now + 160;
            }
            if (body.rebakeAt && now >= body.rebakeAt) {
                body.rebakeAt = 0;
                body.scale = 1; // same ordering rule as finishCollapse
                mountBig(body);
                body.el.style.zIndex = String(FOCUS_Z);
                body.el.classList.add("is-focused");
            }
            break;
        }
    }
}

/* ============================================================================
 * 7. THE SIMULATION
 * ========================================================================== */

/** Rule 1: the world is whatever size the window is, right now. */
function readWorld() {
    WORLD.prevW = WORLD.w;
    WORLD.prevH = WORLD.h;
    WORLD.w = window.innerWidth;
    WORLD.h = window.innerHeight;
}

/**
 * Rule 2: clamp the position AND reflect the velocity, for all four walls.
 * A wall only acts on motion heading into it, so a body riding an inward-
 * moving wall during a resize is never braked by its own clamp.
 */
function resolveWalls(body) {
    const e = CONFIG.wallBounce;
    const maxX = WORLD.w - body.w;
    const maxY = WORLD.h - body.h;

    body.onGround = false;

    if (body.x < 0) {
        body.x = 0;
        if (body.vx < 0) {
            body.contact = true;
            // Slow contacts don't bounce — that's what stops a settled pile
            // from buzzing against the wall forever.
            body.vx =
                -body.vx * (Math.abs(body.vx) > CONFIG.restitutionCutoff ? e : 0);
        }
    } else if (body.x > maxX) {
        body.x = maxX;
        if (body.vx > 0) {
            body.contact = true;
            body.vx =
                -body.vx * (Math.abs(body.vx) > CONFIG.restitutionCutoff ? e : 0);
        }
    }

    if (body.y < 0) {
        body.y = 0;
        if (body.vy < 0) {
            body.contact = true;
            body.vy =
                -body.vy * (Math.abs(body.vy) > CONFIG.restitutionCutoff ? e : 0);
        }
    } else if (body.y > maxY) {
        body.y = maxY;
        body.onGround = true;
        if (body.vy > 0) {
            body.contact = true;
            body.vy =
                -body.vy * (Math.abs(body.vy) > CONFIG.restitutionCutoff ? e : 0);
        }
    }

    // If the window is narrower than the image, pin rather than fight.
    if (maxX < 0) body.x = 0;
    if (maxY < 0) body.y = 0;
}

/**
 * Axis-aligned box collision between two images.
 * Separates them along the axis of *least* penetration, then exchanges
 * velocity along that normal — the rectangle equivalent of the demo's
 * CalVelocity(), which does the same thing along the line between centres.
 */
function resolvePair(a, b) {
    const dx = a.x + a.w / 2 - (b.x + b.w / 2);
    const dy = a.y + a.h / 2 - (b.y + b.h / 2);
    const overlapX = (a.w + b.w) / 2 - Math.abs(dx);
    const overlapY = (a.h + b.h) / 2 - Math.abs(dy);

    if (overlapX <= 0 || overlapY <= 0) return; // not touching

    // Collision normal = the shallower axis.
    let nx = 0;
    let ny = 0;
    let penetration;
    if (overlapX < overlapY) {
        nx = dx < 0 ? -1 : 1;
        penetration = overlapX;
    } else {
        ny = dy < 0 ? -1 : 1;
        penetration = overlapY;
    }

    a.contact = true;
    b.contact = true;

    /* A driven body — under the pointer, or flying to the centre — is treated
       as infinitely heavy (the demo's "fixed" mode): it pushes everything and
       nothing pushes it. That is exactly the "barge through the pile on the
       way to centre" behaviour, for free. */
    const aInv = isDriven(a) ? 0 : a.invMass;
    const bInv = isDriven(b) ? 0 : b.invMass;
    const invSum = aInv + bInv;
    if (invSum === 0) return; // two driven bodies — nothing to solve

    // --- Positional correction (with slop, so resting boxes don't jitter) ---
    const corr =
        (Math.max(penetration - CONFIG.penetrationSlop, 0) / invSum) *
        CONFIG.correction;
    a.x += nx * corr * aInv;
    a.y += ny * corr * aInv;
    b.x -= nx * corr * bInv;
    b.y -= ny * corr * bInv;

    // --- Velocity response ---
    const normalVel = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny;
    if (normalVel > 0) return; // already separating

    // Slow contacts get no bounce — this is what lets a pile settle.
    const e = -normalVel > CONFIG.restitutionCutoff ? CONFIG.bodyBounce : 0;
    const j = (-(1 + e) * normalVel) / invSum;

    a.vx += j * nx * aInv;
    a.vy += j * ny * aInv;
    b.vx -= j * nx * bInv;
    b.vy -= j * ny * bInv;

    // --- Friction along the contact tangent ---
    const tx = -ny;
    const ty = nx;
    const tangentVel = (a.vx - b.vx) * tx + (a.vy - b.vy) * ty;
    const jt = (-tangentVel / invSum) * CONFIG.friction;
    a.vx += jt * tx * aInv;
    a.vy += jt * ty * aInv;
    b.vx -= jt * tx * bInv;
    b.vy -= jt * ty * bInv;
}

/** One animation frame. */
function step(now) {
    rafId = requestAnimationFrame(step);

    const frameScale =
        lastTime === null
            ? 1
            : clamp((now - lastTime) / FRAME_MS, MIN_FRAME_SCALE, MAX_FRAME_SCALE);
    lastTime = now;

    /* --- Rule 1: re-read the walls before anything else. --- */
    readWorld();

    /* --- Resize shove ---------------------------------------------------
       The demo's walls never move, so a wall can only take energy away.
       Ours move constantly, so a wall closing in hands a body its own speed:
       the body is *hit* by the wall, keeps that speed once the resize stops,
       and coasts inward instead of being glued to the edge. */
    if (!skipShove && CONFIG.resizeShove > 0) {
        const wallVX = ((WORLD.w - WORLD.prevW) / frameScale) * CONFIG.resizeShove;
        const wallVY = ((WORLD.h - WORLD.prevH) / frameScale) * CONFIG.resizeShove;
        for (const body of bodies) {
            if (!isSolid(body) || isDriven(body)) continue;
            if (wallVX < 0 && body.x >= WORLD.w - body.w)
                body.vx = Math.min(body.vx, wallVX);
            if (wallVY < 0 && body.y >= WORLD.h - body.h)
                body.vy = Math.min(body.vy, wallVY);
        }
    }
    skipShove = false;

    /* --- Hand-over timer: an image clicked while another was open ---
       Its 600ms head start lets the outgoing image shrink and fall clear
       before this one crosses the middle of the screen.
       This MUST run before the chase loop below. A flight started after it
       would spend its first frame with a stale target and no velocity, and
       the arrival test would fire instantly — the flight would be skipped. */
    if (pendingFocus && now >= pendingAt) startFlight(pendingFocus);

    const dt = frameScale / CONFIG.substeps;
    const gravity = reduceMotion ? 0 : CONFIG.gravity;

    /* --- Rule 5: driven bodies are steered by velocity, not teleported. ---
       Set once per frame (not per substep) so the chase stays stable. This is
       the single place that handles both "follow the cursor" and "fly to the
       centre of the window" — they differ only in the target and the gain. */
    for (const body of bodies) {
        body.contact = false;
        if (!isDriven(body)) continue;

        let gain = CONFIG.chase;
        if (body.mode === "flying") {
            // The click target: put this body's CENTRE at the window's centre.
            body.targetX = WORLD.w / 2 - body.w / 2;
            body.targetY = WORLD.h / 2 - body.h / 2;
            gain = CONFIG.flightChase;
        }

        const tx = clamp(body.targetX, 0, Math.max(0, WORLD.w - body.w));
        const ty = clamp(body.targetY, 0, Math.max(0, WORLD.h - body.h));
        body.vx = (tx - body.x) * gain;
        body.vy = (ty - body.y) * gain;

        /* An exponential chase has a long slow tail. A minimum approach speed
           keeps the last few pixels of the flight from crawling. */
        if (body.mode === "flying") {
            const d = Math.hypot(tx - body.x, ty - body.y);
            const v = Math.hypot(body.vx, body.vy);
            if (d > CONFIG.flightMinSpeed && v > 0 && v < CONFIG.flightMinSpeed) {
                const k = CONFIG.flightMinSpeed / v;
                body.vx *= k;
                body.vy *= k;
            }
        }
    }

    /* --- Rules 3 & 4: substepped integration with per-step damping. --- */
    for (let s = 0; s < CONFIG.substeps; s++) {
        for (const body of bodies) {
            if (!isSolid(body)) continue; // expanded images are out of the sim

            if (isDriven(body)) {
                // No gravity, no drag — holding still feels rock steady, and
                // the flight to centre travels in a straight line.
                body.x += body.vx * dt;
                body.y += body.vy * dt;
                continue;
            }

            body.vy += gravity * dt;
            body.x += body.vx * dt;
            body.y += body.vy * dt;

            // Multiplicative bleed, exactly like `V -= V * air_res`.
            body.vx -= body.vx * CONFIG.airResistance * dt;
            body.vy -= body.vy * CONFIG.airResistance * dt;

            // Runaway guard.
            body.vx = clamp(body.vx, -CONFIG.maxSpeed, CONFIG.maxSpeed);
            body.vy = clamp(body.vy, -CONFIG.maxSpeed, CONFIG.maxSpeed);
        }

        // Body-vs-body, a few passes so stacks resolve rather than sink.
        for (let pass = 0; pass < CONFIG.solverPasses; pass++) {
            for (let i = 0; i < bodies.length - 1; i++) {
                if (!isSolid(bodies[i])) continue;
                for (let j = i + 1; j < bodies.length; j++) {
                    if (!isSolid(bodies[j])) continue;
                    resolvePair(bodies[i], bodies[j]);
                }
            }
        }

        // Walls last, so nothing can be left outside the window by a collision.
        for (const body of bodies) if (isSolid(body)) resolveWalls(body);
    }

    /* --- Focus state machine (flight arrival, zoom, un-zoom) ---
       Every non-physics body is ticked, not just the current `focused` one:
       clicking a second image hands `focused` over immediately while the
       first is still shrinking, and that orphan still needs to finish its
       animation and rejoin the simulation. */
    for (const body of bodies) {
        if (body.mode !== "free" && body.mode !== "grabbed") {
            updateFocus(body, frameScale, now);
        }
    }

    /* --- Settle & sleep -------------------------------------------------
       Anything touching something and barely moving is parked. Without this
       a pile hums quietly forever and the RAF never stops. */
    let moving = pendingFocus !== null; // a waiting hand-over must not sleep
    for (const body of bodies) {
        // Transitions must keep the loop alive; a parked expanded image
        // must not (it is static, so there is nothing to animate).
        if (body.mode === "grabbed" || isBusy(body)) {
            moving = true;
            continue;
        }
        if (body.mode !== "free") {
            // A parked expanded image is static and must not hold the loop
            // open — unless it still owes a re-bake after a resize.
            if (body.rebakeAt) moving = true;
            continue;
        }

        if (body.onGround) {
            body.vx -= body.vx * CONFIG.groundFriction * frameScale;
        }

        if (
            body.contact &&
            Math.abs(body.vx) < CONFIG.restSpeed &&
            Math.abs(body.vy) < CONFIG.restSpeed
        ) {
            body.vx = 0;
            body.vy = 0;
        }

        if (Math.abs(body.vx) > 0.01 || Math.abs(body.vy) > 0.01) moving = true;
    }

    /* Bodies have all moved by now, so this is the moment to ask whether the
       image the cursor was on has slid out from under it. See section 8.5. */
    checkHoverStillValid();

    render();

    const worldStill = WORLD.w === WORLD.prevW && WORLD.h === WORLD.prevH;
    if (!moving && worldStill) {
        if (++idleFrames > SLEEP_FRAMES) sleep();
    } else {
        idleFrames = 0;
    }
}

/**
 * Write positions to the DOM. Transform only — no layout, no repaint cost.
 *
 * The mounted canvas is drawn CENTRED on the physics box and multiplied by
 * `scale`, so a growing image expands about its own middle instead of its
 * top-left corner. For an unexpanded body the mounted size equals the physics
 * size and the scale is 1, so this reduces to a plain translate.
 */
function render() {
    for (const body of bodies) writeTransform(body);
}

/* --- Loop control ---------------------------------------------------------
   Everything that can change the world (a grab, a click, a resize, a new
   image) just calls wake(); nothing else needs to know whether the loop is
   running. */

function wake() {
    idleFrames = 0;
    if (rafId !== null) return;
    skipShove = true; // no trustworthy previous-wall reading yet
    lastTime = null;
    rafId = requestAnimationFrame(step);
}

function sleep() {
    if (rafId !== null) cancelAnimationFrame(rafId);
    rafId = null;
    lastTime = null;
    idleFrames = 0;
}

/* ============================================================================
 * 8. POINTER INPUT
 * ==========================================================================
 * Hit-testing is done by hand, topmost-first, against each image's ALPHA —
 * not its bounding box. So clicking a transparent corner of a cut-out shape
 * passes through to whatever is behind it, the way you'd expect.
 */

/** True if (px, py) in page space lands on a non-transparent pixel of `body`. */
function hitTest(body, px, py) {
    // Work in the body's DISPLAYED rect, which for an expanded image is the
    // scaled-up canvas rather than the physics box.
    const dispW = body.mountedW * body.scale;
    const dispH = body.mountedH * body.scale;
    const left = body.x + body.w / 2 - dispW / 2;
    const top = body.y + body.h / 2 - dispH / 2;

    const lx = px - left;
    const ly = py - top;
    if (lx < 0 || ly < 0 || lx > dispW || ly > dispH) return false;

    try {
        const data = body.ctx.getImageData(
            Math.floor((lx / dispW) * body.mountedW * body.dpr),
            Math.floor((ly / dispH) * body.mountedH * body.dpr),
            1,
            1
        ).data;
        return data[3] > 8; // alpha threshold
    } catch (err) {
        /* getImageData throws on a "tainted" canvas, which happens if you open
           index.html straight off the disk (file://) instead of through a
           server. Fall back to a plain rectangular hit — everything still
           works, transparent corners are just grabbable. */
        return true;
    }
}

function pickBody(px, py) {
    // bodies[] is in paint order, so walk it backwards for topmost-first.
    for (let i = bodies.length - 1; i >= 0; i--) {
        if (hitTest(bodies[i], px, py)) return bodies[i];
    }
    return null;
}

/** Set while a press is in flight, so pointerup can tell a click from a drag. */
let press = null;

function onPointerDown(event) {
    if (event.pointerType === "mouse" && event.button !== 0) return;

    const body = pickBody(event.clientX, event.clientY);

    // Clicking the empty background closes an open image — the affordance
    // people expect from a lightbox, with no extra chrome on the page.
    if (!body) {
        if (focused && focused.mode === "expanded") collapseBody(focused);
        return;
    }

    // Mid-transition images ignore input; letting a flight be interrupted
    // halfway just produces states nobody asked for.
    if (isBusy(body)) return;

    /* NOTE: a press deliberately does NOT touch the tooltip. It belongs to
       "the cursor is on this image", and pressing, dragging or throwing does
       not change that — the reveal plays once per visit and rides out the
       whole gesture. It ends when the cursor leaves (onHoverMove /
       checkHoverStillValid) or when the image leaves the pile (focusBody). */

    event.preventDefault();

    press = {
        body,
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        time: event.timeStamp,
        moved: false,
    };

    /* An expanded image is parked and not draggable — a press on it is only
       ever a click to close. Everything else gets grabbed straight away, so
       dragging still feels immediate. */
    if (body.mode === "expanded") return;

    // Grabbing an image that was queued up to fly cancels the queue — you
    // clearly want to move it, not open it.
    if (pendingFocus === body) {
        pendingFocus = null;
        pendingAt = 0;
    }

    body.mode = "grabbed";
    body.pointerId = event.pointerId;
    body.grabDX = event.clientX - body.x; // grab where you actually clicked,
    body.grabDY = event.clientY - body.y; // don't snap the image to the cursor
    body.targetX = body.x;
    body.targetY = body.y;
    body.el.classList.add("is-held");
    body.el.style.zIndex = String(zCounter++);

    // Bring to the front of the paint/hit order too.
    bodies.splice(bodies.indexOf(body), 1);
    bodies.push(body);

    try {
        body.el.setPointerCapture(event.pointerId);
    } catch (err) {
        /* capture is a nicety; pointer events still work without it */
    }

    wake();
}

function onPointerMove(event) {
    if (press && press.pointerId === event.pointerId && !press.moved) {
        if (
            Math.abs(event.clientX - press.startX) > CONFIG.clickSlop ||
            Math.abs(event.clientY - press.startY) > CONFIG.clickSlop
        ) {
            press.moved = true; // past the slop — this is a drag, not a click
        }
    }

    const body = bodies.find(
        (b) => b.mode === "grabbed" && b.pointerId === event.pointerId
    );
    if (!body) return;
    event.preventDefault();
    // Only record where the cursor wants it. The chase in step() does the
    // actual moving, which keeps input naturally synced to the frame rate.
    body.targetX = event.clientX - body.grabDX;
    body.targetY = event.clientY - body.grabDY;
    wake();
}

function onPointerUp(event) {
    const body = bodies.find(
        (b) => b.mode === "grabbed" && b.pointerId === event.pointerId
    );

    /* --- Was this a click? A short press that barely moved. --- */
    let wasClick = false;
    if (press && press.pointerId === event.pointerId) {
        wasClick =
            !press.moved &&
            Math.abs(event.clientX - press.startX) <= CONFIG.clickSlop &&
            Math.abs(event.clientY - press.startY) <= CONFIG.clickSlop &&
            event.timeStamp - press.time <= CONFIG.clickTime;
    }
    const pressed = press ? press.body : null;
    press = null;

    if (body) {
        body.mode = "free";
        body.pointerId = null;
        body.el.classList.remove("is-held");

        // No hand-off, no separate momentum animation: the chase velocity from
        // rule 5 IS the throw. Moving fast on release → it sails. Still on
        // release → velocity is ~0 and gravity takes it straight down.
        body.vx = clamp(body.vx, -CONFIG.maxThrow, CONFIG.maxThrow);
        body.vy = clamp(body.vy, -CONFIG.maxThrow, CONFIG.maxThrow);

        try {
            body.el.releasePointerCapture(event.pointerId);
        } catch (err) {
            /* already released */
        }
    }

    if (wasClick && pressed) {
        if (pressed.mode === "expanded") collapseBody(pressed);
        else if (pressed.mode === "free") focusBody(pressed);
    }

    wake();
}

window.addEventListener("pointerdown", onPointerDown);
window.addEventListener("pointermove", onPointerMove, { passive: false });
window.addEventListener("pointerup", onPointerUp);
window.addEventListener("pointercancel", onPointerUp);

/** Escape closes an open image. */
window.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && focused && focused.mode === "expanded") {
        collapseBody(focused);
    }
});

/* Resizing only needs to wake the loop — step() re-reads the walls itself. */
window.addEventListener("resize", wake);
window.addEventListener("orientationchange", wake);
if (window.visualViewport) window.visualViewport.addEventListener("resize", wake);

/* ============================================================================
 * 8.5. HOVER TOOLTIP
 * ==========================================================================
 * Three-stage reveal, per spec:
 *   1. a blank `size`×`size` white box with a black stroke fades in (opacity
 *      only, over `fadeMs`), centred on the cursor with its top edge
 *      `cursorGap` below it — see CONFIG.tooltip.
 *   2. the instant that fade finishes, the box's WIDTH animates out (over
 *      `growMs`) to hug the label at `padH` of padding on each side. It grows
 *      SYMMETRICALLY: equally to the left and to the right, with its centre
 *      staying under the cursor throughout. That centring is done in CSS with
 *      `transform: translateX(-50%)` on the box — see styles.css — so no JS
 *      runs per frame to maintain it.
 *   3. only once the box has stopped moving does the label fade in (over
 *      `labelFadeMs`). Nothing is legible mid-animation; the words arrive on
 *      a box that has already settled.
 *
 * LIFECYCLE: one reveal per visit to an image. The sequence starts when the
 * cursor crosses into an image and does not restart, reset, or disappear
 * until the cursor leaves that image again — pressing, dragging and throwing
 * all happen underneath a tooltip that just keeps sitting there. Two things
 * make that hold:
 *
 *   - A DRAG LOCKS THE TOOLTIP to the image being dragged, without
 *     hit-testing. Rule 5's chase means a dragged image LAGS the cursor, so
 *     a quick drag routinely leaves the pointer outside the very image it is
 *     holding; hit-testing alone would strobe the tooltip off and on for the
 *     whole gesture.
 *   - THE HOVER IS RE-CHECKED FROM THE PHYSICS LOOP as well as from
 *     pointermove, because an image can leave a stationary cursor rather than
 *     the other way round — you drop one and it falls away. See
 *     checkHoverStillValid().
 *
 * Otherwise this module is independent of the physics loop in section 7:
 * position tracks the cursor via a plain `pointermove` listener, and all
 * three animation stages are CSS transitions sequenced with setTimeout. So
 * hovering still works while the pile is asleep (see wake() / sleep()), and
 * costs nothing at all when nobody is hovering anything.
 * ========================================================================== */

// One element, reused for every image — only one tooltip is ever on screen.
const tooltipEl = document.createElement("div");
tooltipEl.className = "tooltip";
tooltipEl.hidden = true;
const tooltipBox = document.createElement("div");
tooltipBox.className = "tooltip-box";
const tooltipLabel = document.createElement("span");
tooltipLabel.className = "tooltip-label";
tooltipBox.appendChild(tooltipLabel);
tooltipEl.appendChild(tooltipBox);
document.body.appendChild(tooltipEl);

// A second, invisible element used only to measure label text. Sharing the
// real tooltip's font settings via inline styles (set per-body, since a
// label's font can be overridden per image) keeps the measurement exact.
const measurer = document.createElement("span");
measurer.style.cssText =
    "position:fixed; left:-9999px; top:-9999px; visibility:hidden; white-space:nowrap;";
document.body.appendChild(measurer);

let hoveredBody = null; // the body currently under the cursor, or null
let tooltipVisible = false; // true from the start of the fade-in to the end of the fade-out
let growTimer = null; // pending "stage 1 finished, start stage 2" timeout
let labelTimer = null; // pending "stage 2 finished, start stage 3" timeout
let hideTimer = null; // pending "fade-out finished, actually hide" timeout

/**
 * The pixel width the box needs to fully show `body.label`, never smaller
 * than the blank square it starts as. Computed once per body and cached on
 * it — most images are never hovered in a given visit, so this is paid for
 * lazily rather than for all of them at load time.
 */
function measureTooltipWidth(body) {
    if (body.tooltipWidth !== null) return body.tooltipWidth;
    const cfg = body.tooltipCfg;

    measurer.style.fontFamily = cfg.fontFamily;
    measurer.style.fontWeight = cfg.fontWeight;
    measurer.style.fontSize = cfg.fontSize + "px";
    measurer.style.letterSpacing = cfg.letterSpacing;
    measurer.textContent = body.label;

    // Border-box width: text + padding on both sides + the stroke itself.
    const target =
        measurer.getBoundingClientRect().width +
        cfg.padH * 2 +
        cfg.borderWidth * 2;

    body.tooltipWidth = Math.max(cfg.size, Math.ceil(target));
    return body.tooltipWidth;
}

/**
 * Put the tooltip directly under the cursor, clamped so it never runs
 * off-window.
 *
 * What this writes is the cursor's OWN x, not a left edge — the box shifts
 * itself left by half its own width in CSS (`transform: translateX(-50%)`),
 * which is what keeps its centre pinned to the cursor while it grows.
 */
function positionTooltip(body, clientX, clientY) {
    const cfg = body.tooltipCfg;
    const w = measureTooltipWidth(body);
    const h = cfg.size;

    /* Clamp against the FINAL width rather than the current one. Near a window
       edge the box has to give up dead-centring to stay on screen, and using
       the final width means it settles into that compromise before it starts
       growing — otherwise it would slide sideways mid-growth as the widening
       box ran into the edge. */
    const half = w / 2;
    const minX = cfg.edgeMargin + half;
    const maxX = window.innerWidth - cfg.edgeMargin - half;
    // A label wider than the window can't satisfy both margins: centre it.
    const cx = minX > maxX ? window.innerWidth / 2 : clamp(clientX, minX, maxX);

    const maxTop = Math.max(cfg.edgeMargin, window.innerHeight - h - cfg.edgeMargin);
    const top = clamp(clientY + cfg.cursorGap, cfg.edgeMargin, maxTop);

    tooltipEl.style.transform = "translate3d(" + cx + "px," + top + "px,0)";
}

/** Begin the two-stage reveal for `body`, positioned at the current cursor. */
function showTooltip(body, clientX, clientY) {
    hoveredBody = body;
    tooltipVisible = true;
    clearTimeout(growTimer);
    clearTimeout(labelTimer);
    clearTimeout(hideTimer);

    const cfg = body.tooltipCfg;

    // Apply this image's tooltip config (defaults, or its own overrides —
    // see the `tooltip:` field on an IMAGES entry) to the shared element.
    // These go through custom properties rather than inline transition
    // shorthands: an inline `transitionTimingFunction` would override the
    // per-property easings in the stylesheet all at once, so the opacity
    // fade would silently inherit the width curve.
    tooltipBox.style.setProperty("--tooltip-fade-ms", cfg.fadeMs + "ms");
    tooltipBox.style.setProperty("--tooltip-grow-ms", cfg.growMs + "ms");
    tooltipBox.style.setProperty("--tooltip-grow-ease", cfg.growEasing);
    tooltipLabel.style.setProperty(
        "--tooltip-label-fade-ms",
        cfg.labelFadeMs + "ms"
    );
    tooltipBox.style.background = cfg.fill;
    tooltipBox.style.borderColor = cfg.stroke;
    tooltipBox.style.borderWidth = cfg.borderWidth + "px";
    tooltipBox.style.paddingLeft = cfg.padH + "px";
    tooltipBox.style.paddingRight = cfg.padH + "px";
    tooltipBox.style.height = cfg.size + "px";
    tooltipLabel.textContent = body.label;
    tooltipLabel.style.color = cfg.textColor;
    tooltipLabel.style.fontFamily = cfg.fontFamily;
    tooltipLabel.style.fontWeight = cfg.fontWeight;
    tooltipLabel.style.fontSize = cfg.fontSize + "px";
    tooltipLabel.style.letterSpacing = cfg.letterSpacing;

    /* Reset to the blank-square starting state with transitions switched off,
       so this jump — which may be undoing a previous hover's grown width and
       faded-in label — is instant and invisible rather than being tweened. */
    tooltipBox.classList.remove("is-growing", "is-visible");
    tooltipLabel.classList.remove("is-visible");
    tooltipBox.style.transition = "none";
    tooltipLabel.style.transition = "none";
    tooltipBox.style.width = cfg.size + "px";

    tooltipEl.hidden = false;
    positionTooltip(body, clientX, clientY);

    // Force the browser to commit the state above before transitions are
    // switched back on, or it would tween FROM whatever the box looked like
    // a moment ago instead of snapping to blank first.
    void tooltipBox.offsetWidth;
    tooltipBox.style.transition = "";
    tooltipLabel.style.transition = "";

    // Stage 1: fade the blank box in. One rAF late, so the "remove is-visible"
    // above and this "add it back" are never coalesced into a no-op.
    requestAnimationFrame(() => {
        if (hoveredBody !== body) return; // moved to something else already
        tooltipBox.classList.add("is-visible");
    });

    /* Stage 2 begins only once stage 1 has actually finished, and stage 3 only
       once stage 2 has. Chaining on wall-clock time rather than `transitionend`
       keeps all three stages predictable even if a transition is interrupted
       or never fires (an off-screen or display:none element emits nothing). */
    growTimer = setTimeout(() => {
        if (hoveredBody !== body) return;
        tooltipBox.classList.add("is-growing");
        tooltipBox.style.width = measureTooltipWidth(body) + "px";
    }, cfg.fadeMs);

    // Stage 3: the label, only after the box has stopped moving.
    labelTimer = setTimeout(() => {
        if (hoveredBody !== body) return;
        tooltipLabel.classList.add("is-visible");
    }, cfg.fadeMs + cfg.growMs);
}

/** End the reveal — a quick opacity fade back out, then park off-screen. */
function hideTooltip() {
    if (!tooltipVisible) {
        hoveredBody = null;
        return;
    }
    const cfg = (hoveredBody && hoveredBody.tooltipCfg) || CONFIG.tooltip;
    hoveredBody = null;
    tooltipVisible = false;
    clearTimeout(growTimer);
    clearTimeout(labelTimer);

    /* Only the BOX's opacity is touched. The label keeps whatever opacity it
       had and fades out inside its parent, so the whole thing leaves as one
       object — fading the label separately would make the words vanish first
       and leave an empty box behind. showTooltip() resets it for next time. */
    tooltipBox.classList.remove("is-visible", "is-growing");
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
        if (!tooltipVisible) tooltipEl.hidden = true;
    }, cfg.fadeMs);
}

/**
 * Which image the cursor counts as being "on" right now, or null.
 *
 * While something is being dragged, that image IS the answer, full stop — no
 * hit-test. Rule 5 steers a dragged image toward the cursor rather than
 * pinning it there, so it trails behind during a fast drag and the pointer
 * ends up outside it for stretches of the gesture. Asking the hit-test in
 * that situation produces a tooltip that flickers off and on all the way
 * across the screen; the drag itself is the better evidence of intent.
 */
function hoverTarget(clientX, clientY) {
    const dragging = bodies.find((b) => b.mode === "grabbed");
    const hit = dragging || pickBody(clientX, clientY);
    if (!hit || !hit.label) return null;
    // Thumbnails only. An image on its way to (or sitting at) the centre has
    // left the pile and is no longer something you're browsing past.
    return hit.mode === "free" || hit.mode === "grabbed" ? hit : null;
}

/** Last seen cursor position, so the physics loop can re-check the hover. */
let lastPointerX = null;
let lastPointerY = null;

/**
 * Runs on every pointer move, whether or not a button is down. A press no
 * longer cancels anything: the tooltip belongs to "the cursor is on this
 * image", and pressing does not change that.
 */
function onHoverMove(event) {
    lastPointerX = event.clientX;
    lastPointerY = event.clientY;

    const target = hoverTarget(event.clientX, event.clientY);

    // Already showing for this image: just keep it under the cursor. This is
    // the branch that makes the reveal play exactly once per visit — nothing
    // is reset, so the three stages carry on from wherever they had got to.
    if (target === hoveredBody) {
        if (target) positionTooltip(target, event.clientX, event.clientY);
        return;
    }

    if (target) showTooltip(target, event.clientX, event.clientY);
    else hideTooltip();
}

/**
 * The cursor is not the only thing that can end a hover: an image can leave a
 * STATIONARY cursor. Drop one and it falls out from under you; the pile shifts
 * and shoves it aside. No pointermove fires for any of that, so without this
 * the tooltip would sit there labelling empty space.
 *
 * Called once per frame from step(). Deliberately only lets a hover GO, never
 * acquires a new one — releasing needs a single hit-test on one known body,
 * where acquiring would mean a full pickBody() every frame forever.
 */
function checkHoverStillValid() {
    if (!hoveredBody || lastPointerX === null) return;
    if (hoveredBody.mode === "grabbed") return; // drag-locked, see hoverTarget()
    if (
        hoveredBody.mode !== "free" ||
        !hitTest(hoveredBody, lastPointerX, lastPointerY)
    ) {
        hideTooltip();
    }
}

window.addEventListener("pointermove", onHoverMove, { passive: true });
// Leaving the browser window entirely, or switching tabs/apps: don't leave a
// tooltip hanging that no `pointermove` will ever arrive to clear.
window.addEventListener("pointerleave", hideTooltip);
window.addEventListener("blur", hideTooltip);

/* ============================================================================
 * 9. DRAG-AND-DROP (optional convenience)
 * ==========================================================================
 * Dropping image files onto the window adds them straight away, which is handy
 * for trying artwork out. They are NOT saved — to keep one, put the file in
 * this folder and add its name to the IMAGES list at the top.
 */

let dragDepth = 0;

window.addEventListener("dragenter", (event) => {
    event.preventDefault();
    dragDepth++;
    dropHint.hidden = false;
});

window.addEventListener("dragover", (event) => event.preventDefault());

window.addEventListener("dragleave", (event) => {
    event.preventDefault();
    if (--dragDepth <= 0) {
        dragDepth = 0;
        dropHint.hidden = true;
    }
});

window.addEventListener("drop", async (event) => {
    event.preventDefault();
    dragDepth = 0;
    dropHint.hidden = true;

    const files = Array.from(event.dataTransfer.files || []).filter((f) =>
        f.type.startsWith("image/")
    );

    for (const file of files) {
        const url = URL.createObjectURL(file);
        try {
            const img = await loadImage(url);
            addBody(img);
        } catch (err) {
            console.warn("Skipped", file.name, err);
        } finally {
            // The pixels are already baked into a canvas, so the blob URL can
            // be released immediately.
            URL.revokeObjectURL(url);
        }
    }
});

/* ============================================================================
 * 10. BOOT
 * ========================================================================== */

async function init() {
    readWorld();
    WORLD.prevW = WORLD.w;
    WORLD.prevH = WORLD.h;

    for (const entry of IMAGES) {
        // An entry is either a bare filename, or { src, label, tooltip }.
        const src = typeof entry === "string" ? entry : entry.src;
        try {
            const img = await loadImage(src);
            addBody(img, typeof entry === "string" ? null : entry);
        } catch (err) {
            console.warn(
                'Could not load "' +
                    src +
                    '". Check that the file is in this folder and the name in ' +
                    "IMAGES matches exactly (including capitals and extension)."
            );
        }
    }

    wake();
}

init();
