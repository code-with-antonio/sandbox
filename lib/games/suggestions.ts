import {
  BrushIcon,
  CarIcon,
  CrosshairIcon,
  Gamepad2Icon,
  PickaxeIcon,
  PlaneIcon,
  ZapIcon,
} from "lucide-react"

/**
 * The starting points offered under the home page composer.
 *
 * The label is what the button says; the prompt is what is actually built. They
 * are deliberately different lengths — a button has room for two words, and the
 * agent needs a brief. So each prompt says what the player does, what it looks
 * like, and how a round ends, because a first turn spent guessing at those is a
 * first turn that produces someone else's game.
 *
 * They stay in the player's voice rather than the agent's: nothing here names
 * a file, an engine primitive, or a three.js class. The system prompt in
 * `@/lib/games/instructions` already covers how a game is built — these only
 * have to settle what to build.
 */
export const suggestions = [
  {
    label: "Voxel survival",
    icon: PickaxeIcon,
    prompt:
      "A first-person voxel survival game on an island of chunky cube terrain — " +
      "grass, stone, sand, water — that generates differently every run. I can " +
      "mine any block by holding the mouse and place blocks from a hotbar I " +
      "select with the number keys. Day turns to night on a few-minute cycle, " +
      "and once it is dark, cube-headed creatures spawn away from light and come " +
      "for me. Show health and the current block in a small HUD. Surviving three " +
      "nights wins; losing all my health ends the run.",
  },
  {
    label: "Ink samurai duel",
    icon: BrushIcon,
    prompt:
      "A one-on-one samurai duel rendered like wet ink on rice paper: white " +
      "background, black silhouettes, hard brush-stroke edges, a single red sun " +
      "behind us. Side-on view of two fighters. I attack, and — the important " +
      "part — I parry with precise timing: a parry in the instant before a blow " +
      "lands staggers my opponent and opens them up, while a mistimed one leaves " +
      "me exposed. Two hits end a duel either way, so rounds are short and tense. " +
      "Splash ink across the screen on every hit. Best of five wins the match.",
  },
  {
    label: "Comic-book firefight",
    icon: ZapIcon,
    prompt:
      "A third-person shooter that looks like a comic book page: flat cel-shaded " +
      "colours, thick black outlines on everything, halftone dots in the shadows. " +
      "I move and shoot through a city rooftop arena while waves of enemies close " +
      "in. Every hit punches out a hand-lettered POW or BAM sound-effect word that " +
      "pops, tilts and fades. Waves get bigger and faster; the HUD shows my health " +
      "and the wave number. Dying ends the run and shows how far I got.",
  },
  {
    label: "Realistic battlefield",
    icon: PlaneIcon,
    prompt:
      "A grounded military flight mission over a wide battlefield valley at dawn — " +
      "haze, long shadows, muted greens and greys, no cartoon colours. I fly a jet " +
      "in third person: pitch and roll with the mouse, throttle on the keyboard. " +
      "Anti-air guns on the ridges track me and I have to stay low and fast to " +
      "survive them. Give me a proper cockpit-style HUD with altitude, speed and a " +
      "target marker. Destroy the four convoy targets to win; taking too much fire " +
      "or hitting the ground ends the mission.",
  },
  {
    label: "Fight-first shooter",
    icon: CrosshairIcon,
    prompt:
      "An arena shooter that rewards pushing forward instead of hiding. I have a " +
      "gun and a melee attack, and my health only refills when I finish a stunned " +
      "enemy up close — so backing off to heal is never an option. Enemies stagger " +
      "and glow when they are low, which is my cue to close the distance. Fast " +
      "movement, no cover mechanic, aggressive tempo. Bold saturated colours and " +
      "an industrial arena. Clear five waves to win.",
  },
  {
    label: "Jungle expedition drive",
    icon: CarIcon,
    prompt:
      "A driving game through dense jungle in a beat-up expedition truck. Third " +
      "person, behind the truck, on a muddy track winding between huge trees with " +
      "light breaking through the canopy. The suspension should feel it — the truck " +
      "leans in corners and bottoms out over roots and ruts. Mud slows me, puddles " +
      "throw spray. Checkpoints along the route each add time to the clock. Reach " +
      "the ruins at the end of the trail before the clock runs out.",
  },
  {
    label: "Sunny kingdom platformer",
    icon: Gamepad2Icon,
    prompt:
      "A cheerful 3D platformer in a bright storybook kingdom: rolling green hills, " +
      "candy-coloured castle towers, a big blue sky with fat clouds. I control a " +
      "round little hero in third person who runs, jumps and double-jumps between " +
      "floating platforms, bouncing mushrooms and moving lifts. Scatter coins along " +
      "the route to show me where to go, and put a few wandering enemies I can " +
      "bounce off the top of. Collect every coin and reach the castle gate to win; " +
      "falling off drops me back at the last platform I stood on.",
  },
]
