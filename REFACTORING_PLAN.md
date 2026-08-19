# Space Hulk: Death Angel PWA - Refactoring Plan

**Generated:** 2026-08-19  
**Reviewer:** Ned (Code Puppy)  
**Target Agent:** Codex  
**Project Status:** Phase 10 - First playable mobile GUI (completed in 1 week!)

---

## Executive Summary

This is a **well-architected, production-quality game implementation** with excellent test coverage, type safety, and accessibility. The primary issues are **file size bloat** and **component granularity** that violate SOLID principles and make maintenance difficult.

**Current Rating:** 7.5/10  
**Target Rating:** 9.5/10 (after refactoring)

---

## Strengths to Preserve

###  DO NOT CHANGE These Patterns

1. **Engine-First Architecture** (ADR 0001)
   - Strict dependency: data → engine → controller → UI
   - Framework-independent TypeScript rules engine
   - UI only renders state and submits legal options
   - **Keep this separation sacred**

2. **Type Safety**
   - TypeScript strict mode
   - Comprehensive type definitions in `src/engine/state/game-state.ts`
   - No `any` types found

3. **Testing Infrastructure**
   - Unit tests for engine logic
   - Golden fixture certification with exact hash validation
   - Invariant validation (`src/engine/validation/invariants.ts`)
   - **Add to, don't remove**

4. **Accessibility**
   - ARIA labels throughout
   - `aria-live`, `role`, `aria-modal` properly used
   - Keyboard navigation support
   - **Maintain WCAG 2.2 Level AA compliance**

5. **Deterministic RNG**
   - SHA256-based counter RNG
   - Perfect replay capability
   - Certification-grade test fixtures
   - **This is brilliant, don't touch it**

---

## Critical Issues Requiring Immediate Attention

###  Issue #1: `app/game-client.tsx` (1,515 lines)

**Problem:**  
God component violating Single Responsibility Principle. Contains:
- Setup panel logic
- Action selection UI
- Mission board rendering
- Formation board orchestration
- Tutorial system
- HUD management
- 30+ helper functions
- State management for entire app
- Animation coordination
- Event handlers

**Target:** Break into 10-15 focused components, each under 200 lines.

**Proposed Structure:**

```
app/
  game-client.tsx                    # Main orchestrator (~150-200 lines)
  components/
    setup/
      SetupPanel.tsx                 # Team selection, game setup
      TeamSelector.tsx               # Individual team choice component
      TeamPreview.tsx                # Action card preview modal
    
    mission/
      MissionBoard.tsx               # Main board container (~150 lines)
      MissionHUD.tsx                 # Status display, undo, menu
      MissionInfo.tsx                # Location, blips, event card
      RoundTray.tsx                  # Action cards + info panel toggle
    
    formation/
      LiveFormationBoard.tsx         # Formation grid orchestrator
      FormationRow.tsx               # Single row of formation
      FlankView.tsx                  # Left/right flank rendering
      MarineCell.tsx                 # Individual marine display
      SwarmCell.tsx                  # Genestealer swarm display
      TerrainCell.tsx                # Terrain card display
    
    actions/
      LiveActionSelection.tsx        # Action card selection interface
      ActionDock.tsx                 # Bottom action card tray
      ActionCard.tsx                 # Individual action card component
    
    decisions/
      CommandDock.tsx                # Decision prompts and buttons
      ScoutingPreview.tsx            # Forward Scouting event preview
      SlaySwarmOverlay.tsx           # Genestealer target selection
      DieRollResult.tsx              # Combat die animation/result
    
    tutorial/
      TutorialCoach.tsx              # Guidance sidebar
      TutorialHudTour.tsx            # HUD element tour
    
    ui/
      TacticalButton.tsx             # Reusable button with tap/hold
      InspectionDrawer.tsx           # Card detail modal
      HoverInspection.tsx            # Desktop hover tooltips
      ResolutionNotice.tsx           # Action resolution overlay
      MissionEndReport.tsx           # Victory/defeat screen
    
    helpers/
      decisionFormatters.ts          # Decision text formatting
      noticeBuilders.ts              # Resolution notice creation
      animationHelpers.ts            # Animation state management
      inspectionHelpers.ts           # Inspection data builders
      tutorialHelpers.ts             # Tutorial guidance logic
```

**Migration Steps:**

1. **Extract UI components first** (no logic changes):
   - `TacticalButton` (lines 523-567)
   - `TeamActionPreview` (lines 639-647)
   - `TutorialCoach` (lines 251-255)
   - `TutorialHudTour` (lines 266-273)

2. **Extract helper functions** to `helpers/`:
   - `formatPhase`, `formatActionType`, `actionCardSummary`
   - `decisionInstruction`, `decisionBriefTitle`, `conciseDecisionButtonLabel`
   - `rollNoticesFrom`, `resolutionNoticesFrom`
   - `eventMovementAnimationFrom`, `eventMovementPresentationFrom`
   - `attackTrajectory`, `pendingTargetIds`, `uniquePayloadOption`

3. **Extract complex sub-components**:
   - `LiveActionSelection` (lines 568-637)
   - `MissionBoard` (lines 1044-1223)
   - `LiveFormationBoard` (lines 1257-1369)
   - `FormationRow` (lines 1371-1397)
   - `Flank` (lines 1398-1445)

4. **Create state management layer**:
   - Move `useState` hooks to custom hooks or Zustand store
   - Group related state (UI state vs game state)
   - Extract derived state to `useMemo` hooks

**Success Criteria:**
- Main `game-client.tsx` under 200 lines
- No component over 250 lines
- Each file has single clear responsibility
- All tests still pass
- No gameplay regressions

---

###  Issue #2: `src/engine/controller.ts` (1,605 lines)

**Problem:**  
Monolithic controller handling all game phases in one file.

**Proposed Structure:**

```
src/engine/
  controller.ts                      # Main orchestrator (~300 lines)
  
  phases/
    setupPhase.ts                    # Setup logic
    chooseActionsPhase.ts            # Action selection
    resolveActionsPhase.ts           # Action resolution pipeline
    genestealerAttackPhase.ts        # Hostile attack logic
    eventPhase.ts                    # Event card processing
  
  decisions/
    decisionBuilder.ts               # Create PendingDecision objects
    decisionValidator.ts             # Validate option legality
    decisionResolver.ts              # Apply decision to state
  
  pipelines/
    actionPipeline.ts                # Action resolution steps
    attackPipeline.ts                # Combat resolution
    movementPipeline.ts              # Marine movement
    travelPipeline.ts                # Location travel
  
  state/
    stateTransitions.ts              # Phase transitions
    stateQueries.ts                  # Read-only state helpers
```

**Migration Steps:**

1. **Identify phase boundaries** by searching for:
   - `case "SETUP":`
   - `case "CHOOSE_ACTIONS":`
   - `case "RESOLVE_ACTIONS":`
   - `case "GENESTEALER_ATTACK":`
   - `case "EVENT":`

2. **Extract each phase** to its own module with exports:
   ```typescript
   export function advanceSetupPhase(state: GameState): EngineResult
   export function setupDecisions(state: GameState): PendingDecision | null
   ```

3. **Consolidate decision logic**:
   - All decision creation → `decisionBuilder.ts`
   - All option validation → `decisionValidator.ts`
   - All decision application → `decisionResolver.ts`

4. **Extract pipeline functions**:
   - Group related functions by feature (attack, movement, travel)
   - Maintain import organization

**Success Criteria:**
- `controller.ts` is just a phase dispatcher
- Each phase module under 400 lines
- Clear separation of concerns
- All existing tests pass
- Add unit tests for individual phase modules

---

###  Issue #3: `app/globals.css` (267 lines / 59.1 KB)

**Problem:**  
File is suspiciously large for line count. Likely contains:
- Embedded data URIs
- Inline SVGs
- Base64-encoded images

**Investigation Required:**

```bash
# Check for data URIs
grep -c "data:image" app/globals.css
grep -c "url(data:" app/globals.css

# Check for base64
grep -c "base64" app/globals.css
```

**Proposed Solutions:**

1. **Extract data URIs** to separate asset files
2. **Move component styles** to CSS modules:
   ```
   app/components/ui/TacticalButton.module.css
   app/components/mission/MissionBoard.module.css
   ```

3. **Consider CSS-in-JS** for dynamic styles:
   ```tsx
   import { css } from '@emotion/react';
   const buttonStyle = css`
     background: ${props.teamColor};
   `;
   ```

4. **Run PurgeCSS** to remove unused rules

**Success Criteria:**
- `globals.css` under 10 KB
- Component styles co-located with components
- No embedded data URIs in CSS

---

## Medium Priority Issues

###  Issue #4: Prop Interface Bloat

**Problem:**  
Components accept 15-22 props without clear grouping.

**Example (MissionBoard - 22 props):**
```tsx
function MissionBoard({ 
  session, travelStage, tutorial, boardAnimation, inspection, 
  hoverInspection, presentationSettings, onTogglePresentationSetting, 
  error, resolutionNotice, rollNotice, rollDecision, slayChoiceAnimating, 
  onInspect, onHoverInspect, onDismissHoverInspection, onChooseOption, 
  onUndo, onDownloadSave, onDismissInspection, onDismissResolutionNotice, 
  onDismissRoll, onNewMission 
}: MissionBoardProps)
```

**Solution - Group Related Props:**

```tsx
type MissionBoardProps = {
  // Core game state
  session: EngineSession;
  
  // UI state
  ui: {
    travelStage?: TravelStage;
    tutorial: boolean;
    presentationSettings: PresentationSettings;
  };
  
  // Active overlays
  overlays: {
    inspection?: Inspection;
    hoverInspection?: HoverInspection;
    resolutionNotice?: ResolutionNotice;
    rollNotice?: RollNotice;
    error?: string;
  };
  
  // Animation state
  animation?: {
    board?: BoardAnimation;
    slayChoiceAnimating: boolean;
  };
  
  // Interactions
  interactions: {
    onChooseOption: (id: string) => void;
    onInspect: (inspection: Inspection) => void;
    onHoverInspect: (inspection: Inspection, anchor: DOMRect) => void;
    onDismissHoverInspection: () => void;
    onUndo: () => void;
    onDownloadSave: () => void;
    onDismissInspection: () => void;
    onDismissResolutionNotice: () => void;
    onDismissRoll: () => void;
    onNewMission: () => void;
    onTogglePresentationSetting: (key: keyof PresentationSettings) => void;
  };
  
  // Decisions
  decisions?: {
    rollDecision?: PendingDecision;
  };
};
```

**Apply to All Components:**
- Group props by concern
- Use optional chaining for nullable groups
- Document each group with TSDoc

---

###  Issue #5: Missing Performance Optimizations

**Problem:**  
No memoization for expensive computations or callbacks.

**Add These Optimizations:**

```tsx
// In GameClient component:

// Memoize expensive computations
const formationRows = useMemo(
  () => labRows(session),
  [session.state.transitionSeq]
);

const tutorialGuide = useMemo(
  () => tutorialActionGuide(session),
  [session.state.phase, session.state.actionStep]
);

// Memoize callbacks
const handleChooseOption = useCallback(
  (optionId: string) => {
    submitChoice(optionId);
  },
  [submitChoice]
);

const handleInspect = useCallback(
  (inspection: Inspection) => {
    setInspection(inspection);
  },
  []
);

// Memoize components that receive callbacks
const MemoizedFormationBoard = memo(LiveFormationBoard);
```

**Target Areas:**
- `labRows()` function (called every render)
- Event handlers passed to child components
- Derived state calculations
- Animation state computations

---

###  Issue #6: State Management Architecture

**Problem:**  
Using `useState` for complex game state in main component.

**Recommendation:**  
Evaluate **Zustand** for lightweight state management:

```typescript
// stores/gameStore.ts
import create from 'zustand';

type GameStore = {
  session: EngineSession | null;
  ui: {
    inspection: Inspection | null;
    hoverInspection: HoverInspection | null;
    tutorial: boolean;
  };
  animations: {
    board: BoardAnimation | null;
    rolling: boolean;
  };
  
  // Actions
  setSession: (session: EngineSession) => void;
  setInspection: (inspection: Inspection | null) => void;
  setHoverInspection: (inspection: HoverInspection | null) => void;
  // ... etc
};

export const useGameStore = create<GameStore>((set) => ({
  session: null,
  ui: {
    inspection: null,
    hoverInspection: null,
    tutorial: false,
  },
  animations: {
    board: null,
    rolling: false,
  },
  
  setSession: (session) => set({ session }),
  setInspection: (inspection) => 
    set((state) => ({ ui: { ...state.ui, inspection } })),
  // ... etc
}));
```

**Benefits:**
- Eliminates prop drilling
- Easier to test
- Better TypeScript inference
- Simple time-travel debugging

**Alternative:** Keep `useState` but extract to custom hooks:
```tsx
// hooks/useGameState.ts
export function useGameState() {
  const [session, setSession] = useState<EngineSession | null>(null);
  const [inspection, setInspection] = useState<Inspection | null>(null);
  // ... group related state
  
  return {
    session,
    setSession,
    inspection,
    setInspection,
    // ...
  };
}
```

---

## Low Priority Enhancements

###  Issue #7: Missing End-to-End Tests

**Current Coverage:**  
 Unit tests for engine logic  
 Certification tests with golden fixtures  
 No E2E tests for UI flows

**Add Playwright Tests:**

```typescript
// tests/e2e/game-flow.spec.ts
import { test, expect } from '@playwright/test';

test('Complete solo game flow', async ({ page }) => {
  await page.goto('/');
  
  // Setup
  await page.click('[data-testid="team-green"]');
  await page.click('[data-testid="team-blue"]');
  await page.click('[data-testid="team-red"]');
  await page.click('[data-testid="start-mission"]');
  
  // Choose actions
  await expect(page.locator('.phase-indicator')).toContainText('Choose Actions');
  await page.click('[data-testid="action-green"]');
  await page.click('[data-testid="confirm-action"]');
  
  // ... continue through game phases
});

test('Undo functionality', async ({ page }) => {
  // ... test undo/redo behavior
});

test('Tutorial flow', async ({ page }) => {
  await page.goto('/?tutorial=true');
  // ... verify tutorial guidance appears
});

test('Victory condition', async ({ page }) => {
  // ... test reaching location tier 3
});

test('Defeat condition', async ({ page }) => {
  // ... test all marines dying
});
```

**Test Coverage Goals:**
- Full game playthrough (setup → victory/defeat)
- Undo/redo across phase boundaries
- Tutorial step-through
- Save/load game state
- Edge cases (all marines die, deck exhaustion)

---

###  Issue #8: Add React Error Boundaries

**Problem:**  
No error boundaries to catch render crashes.

**Add Error Boundary:**

```tsx
// components/ui/ErrorBoundary.tsx
import { Component, type ReactNode } from 'react';

type Props = {
  children: ReactNode;
  fallback?: ReactNode;
};

type State = {
  hasError: boolean;
  error: Error | null;
};

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: unknown) {
    console.error('Game render error:', error, errorInfo);
    // TODO: Send to error tracking service
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback || (
        <div className="error-screen">
          <h1>Something went wrong</h1>
          <p>The game encountered an error. Please refresh the page.</p>
          <button onClick={() => window.location.reload()}>
            Reload Game
          </button>
          {this.state.error && (
            <details>
              <summary>Error details</summary>
              <pre>{this.state.error.message}</pre>
            </details>
          )}
        </div>
      );
    }

    return this.props.children;
  }
}
```

**Usage:**

```tsx
// app/game-client.tsx
export default function GameClient() {
  return (
    <ErrorBoundary>
      <div className="game-client">
        {/* ... game UI */}
      </div>
    </ErrorBoundary>
  );
}
```

---

###  Issue #9: PWA Improvements

**Current State:**  
Basic PWA manifest exists.

**Enhancements Needed:**

1. **Offline Fallback Page:**
```html
<!-- public/offline.html -->
<!DOCTYPE html>
<html>
<head>
  <title>Death Angel - Offline</title>
</head>
<body>
  <h1>You're offline</h1>
  <p>Death Angel requires an internet connection for the initial load.</p>
  <button onclick="window.location.reload()">Retry</button>
</body>
</html>
```

2. **Service Worker for Caching:**
```javascript
// public/sw.js
const CACHE_VERSION = 'v1';
const ASSETS_TO_CACHE = [
  '/',
  '/game-art/marine/idle.png',
  '/game-art/genestealer/idle.png',
  // ... critical assets
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => {
      return cache.addAll(ASSETS_TO_CACHE);
    })
  );
});
```

3. **Install Prompt:**
```tsx
// components/ui/InstallPrompt.tsx
export function InstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  
  useEffect(() => {
    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };
    
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);
  
  const handleInstall = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    setDeferredPrompt(null);
  };
  
  if (!deferredPrompt) return null;
  
  return (
    <div className="install-prompt">
      <p>Install Death Angel for offline play</p>
      <button onClick={handleInstall}>Install</button>
    </div>
  );
}
```

4. **Background Sync for Save Games** (optional):
```typescript
// Sync save game to cloud when connection restored
if ('sync' in navigator) {
  await (navigator as any).sync.register('sync-save-game');
}
```

---

###  Issue #10: Documentation Gaps

**Add Component Documentation:**

```tsx
/**
 * TacticalButton - Interactive button with tap, hold, and hover support
 * 
 * @example
 * ```tsx
 * <TacticalButton
 *   onTap={() => selectAction()}
 *   onHold={() => showDetails()}
 *   onHover={(anchor) => showTooltip(anchor)}
 * >
 *   Select Action
 * </TacticalButton>
 * ```
 * 
 * @param onTap - Fired on click/tap (< 420ms press)
 * @param onHold - Fired on long press (≥ 420ms)
 * @param onHover - Fired on pointer enter (desktop only)
 * @param onHoverEnd - Fired on pointer leave
 * @param stopPropagation - Prevent event bubbling
 */
export function TacticalButton({ ... }: TacticalButtonProps) {
  // ...
}
```

**Add README Sections:**

```markdown
## Architecture

### Component Structure
- `/app` - Next.js app directory (UI entry point)
- `/src/engine` - Framework-agnostic game rules
- `/src/ui-adapter` - Engine-to-UI bridge
- `/src/ui-lab` - Reusable UI components
- `/src/data` - Generated game data

### State Flow
1. User interaction triggers UI event
2. UI calls `submitSessionDecision(optionId)`
3. Engine validates option and updates canonical state
4. Engine returns new state + legal decisions
5. UI re-renders with new state

### Testing Strategy
- **Unit tests** (`*.test.ts`) - Engine logic
- **Integration tests** (`certification/*.test.ts`) - Full game flows
- **E2E tests** (`tests/e2e/*.spec.ts`) - UI interactions

## Development

### Local Development
```bash
pnpm install
pnpm data:import  # Generate runtime data from Excel
pnpm test         # Run unit tests
pnpm dev          # Start dev server
```

### Building for Production
```bash
pnpm build        # Build optimized bundle
pnpm start        # Serve production build
```

### Common Tasks
- **Add new card:** Update `docs/source/Death_Angel_Base_Game_Gameplay_Database.xlsx`, run `pnpm data:import`
- **Add new test:** Create `*.test.ts` file, run `pnpm test`
- **Debug state:** Check `session.state` in React DevTools

## Game Rules Implementation

### Canonical State
All gameplay state lives in `GameState` (see `src/engine/state/game-state.ts`).

Key principles:
- Deterministic: Same inputs → same outputs
- Serializable: Can save/load via JSON
- Validated: `assertStateInvariants()` catches corruption

### Decision Flow
1. Engine issues `PendingDecision` with legal options
2. UI presents options to player
3. Player selects option
4. Engine applies option and advances state
5. Repeat until game end or new decision needed

### Undo System
- Player-safe undo up to randomness/hidden-info barrier
- Test undo (unrestricted, invalidates certification)
- Undo history stored in session metadata, not game state
```

---

## Edge Cases to Test

###  Identified Edge Cases

1. **LocalStorage Full**
   ```typescript
   // Add error handling for save games
   try {
     localStorage.setItem(SAVED_GAME_KEY, serialized);
   } catch (e) {
     if (e.name === 'QuotaExceededError') {
       alert('Storage full. Delete old saves to continue.');
     }
   }
   ```

2. **App Closed Mid-Animation**
   ```typescript
   // Save state before animation starts
   useEffect(() => {
     if (boardAnimation) {
       saveGameState(session);
     }
   }, [boardAnimation]);
   ```

3. **Page Refresh During Decision**
   ```typescript
   // Auto-save on decision prompt
   useEffect(() => {
     if (session?.pendingDecision) {
       saveGameState(session);
     }
   }, [session?.pendingDecision]);
   ```

4. **Rapid Undo/Redo**
   ```typescript
   // Debounce undo button
   const debouncedUndo = useMemo(
     () => debounce(handleUndo, 200),
     [handleUndo]
   );
   ```

5. **Invalid Save Data**
   ```typescript
   // Validate on load
   try {
     const session = loadEngineSession(data);
     assertStateInvariants(session.state);
   } catch (e) {
     console.error('Corrupt save game:', e);
     // Offer to start new game
   }
   ```

---

## Performance Profiling Checklist

###  Before Optimizing

1. **Baseline Metrics:**
   ```bash
   # Build production bundle
   pnpm build
   
   # Analyze bundle size
   npx vite-bundle-visualizer
   
   # Check for large dependencies
   npx webpack-bundle-analyzer
   ```

2. **React DevTools Profiling:**
   - Record interaction session
   - Identify components re-rendering unnecessarily
   - Check "Highlight updates" to see render frequency

3. **Lighthouse Audit:**
   - Performance score
   - First Contentful Paint
   - Time to Interactive
   - Total Blocking Time

###  After Refactoring

1. **Re-run Profiling:**
   - Compare bundle size (target: < 500 KB gzipped)
   - Compare render times
   - Verify no new performance regressions

2. **Animation Performance:**
   ```tsx
   // Add will-change for animated elements
   .marine-sprite {
     will-change: transform;
   }
   
   // Use transform instead of position
   .moving-swarm {
     transform: translateY(-100px);  /* Good */
     /* top: -100px; */              /* Bad */
   }
   ```

3. **Image Optimization:**
   ```bash
   # Check sprite sizes
   ls -lh public/game-art/**/*.png
   
   # Optimize with sharp/imagemin if needed
   ```

---

## Migration Checklist

### Phase 1: Component Extraction (Week 1)

- [ ] Extract `TacticalButton` to `components/ui/TacticalButton.tsx`
- [ ] Extract `TutorialCoach` to `components/tutorial/TutorialCoach.tsx`
- [ ] Extract `TutorialHudTour` to `components/tutorial/TutorialHudTour.tsx`
- [ ] Extract `TeamActionPreview` to `components/setup/TeamPreview.tsx`
- [ ] Extract helper functions to `helpers/` directory
- [ ] Run tests: `pnpm test`
- [ ] Manual QA: Full game playthrough

### Phase 2: Major Component Split (Week 2)

- [ ] Split `LiveActionSelection` → `components/actions/`
- [ ] Split `MissionBoard` → `components/mission/MissionBoard.tsx`
- [ ] Split `LiveFormationBoard` → `components/formation/`
- [ ] Split `FormationRow` → `components/formation/FormationRow.tsx`
- [ ] Split `Flank` → `components/formation/FlankView.tsx`
- [ ] Add prop interface grouping
- [ ] Run tests: `pnpm test`
- [ ] Manual QA: Full game playthrough

### Phase 3: Performance Optimization (Week 3)

- [ ] Add `useMemo` for `labRows()`
- [ ] Add `useCallback` for event handlers
- [ ] Add `memo()` for expensive components
- [ ] Profile with React DevTools
- [ ] Run Lighthouse audit
- [ ] Run tests: `pnpm test`

### Phase 4: Controller Refactoring (Week 4)

- [ ] Extract `setupPhase.ts`
- [ ] Extract `chooseActionsPhase.ts`
- [ ] Extract `resolveActionsPhase.ts`
- [ ] Extract `genestealerAttackPhase.ts`
- [ ] Extract `eventPhase.ts`
- [ ] Extract decision modules
- [ ] Run tests: `pnpm test`
- [ ] Manual QA: Full game playthrough

### Phase 5: CSS Optimization (Week 5)

- [ ] Audit `globals.css` for data URIs
- [ ] Extract data URIs to asset files
- [ ] Convert to CSS modules where appropriate
- [ ] Run PurgeCSS
- [ ] Verify visual regression

### Phase 6: Testing & Documentation (Week 6)

- [ ] Add E2E tests with Playwright
- [ ] Add error boundaries
- [ ] Add component TSDoc comments
- [ ] Update README.md
- [ ] Add contributing guidelines
- [ ] Final QA pass

### Phase 7: Enhancements (Week 7+)

- [ ] Evaluate Zustand for state management
- [ ] Add PWA offline support
- [ ] Add install prompt
- [ ] Add performance monitoring
- [ ] Add error tracking (Sentry?)

---

## Testing Requirements

###  All Changes Must:

1. **Pass existing tests:**
   ```bash
   pnpm test
   ```

2. **Pass type checking:**
   ```bash
   pnpm typecheck
   ```

3. **Pass linting:**
   ```bash
   pnpm lint
   ```

4. **Maintain certification:**
   - Golden fixture tests still pass
   - REG1-REG22 matrix unchanged
   - Deterministic replay works

5. **No gameplay regressions:**
   - Play through complete game
   - Test undo/redo
   - Test victory condition
   - Test defeat condition
   - Test all action types
   - Test all location abilities

---

## Success Metrics

###  Targets After Refactoring

| Metric | Current | Target | Measurement |
|--------|---------|--------|-------------|
| Largest component file | 1,515 lines | < 250 lines | Line count |
| Largest engine file | 1,605 lines | < 400 lines | Line count |
| CSS bundle size | 59 KB | < 10 KB | Webpack stats |
| Test coverage | ~70% | > 80% | Vitest coverage |
| Lighthouse Performance | ??? | > 90 | Lighthouse |
| First Contentful Paint | ??? | < 1.5s | Lighthouse |
| Time to Interactive | ??? | < 3.0s | Lighthouse |
| Bundle size (gzipped) | ??? | < 500 KB | Build stats |
| Number of re-renders | High | Minimal | React DevTools |

---

## Notes for Codex

###  Implementation Guidelines

1. **Preserve Functionality:**
   - This is refactoring, not rewriting
   - Every feature must work exactly as before
   - No changes to game logic or rules engine

2. **Maintain Test Coverage:**
   - All existing tests must pass
   - Add new tests for extracted components
   - Certification tests are sacred

3. **Keep Type Safety:**
   - No `any` types
   - Strict mode enabled
   - Explicit return types on functions

4. **Follow Existing Patterns:**
   - Use existing naming conventions
   - Match existing code style
   - Maintain ARIA labels and accessibility

5. **Document Changes:**
   - Add TSDoc comments to new components
   - Update README if architecture changes
   - Add migration notes for breaking changes

6. **Test Incrementally:**
   - Extract one component at a time
   - Run tests after each extraction
   - Commit after each successful refactor

7. **Ask When Uncertain:**
   - If game logic is unclear, ask before changing
   - If architectural decision is ambiguous, ask
   - If test failure is unexpected, ask

---

## Questions for Daniel

Before starting refactoring, please confirm:

1. **Zustand vs useState:** Prefer state management library or keep hooks?
2. **CSS approach:** CSS modules, Tailwind, or CSS-in-JS?
3. **E2E framework:** Playwright (recommended) or Cypress?
4. **Timeline:** Follow 7-week plan or prioritize differently?
5. **Breaking changes:** OK to change component APIs if internal?
6. **Deploy target:** Vercel, Netlify, Cloudflare Pages, or self-hosted?

---

## Conclusion

This is an **exceptionally well-engineered project** for a one-week sprint. The refactoring plan focuses on **maintainability and scalability** without changing the excellent architecture you've established.

The primary goal is to **break large files into focused, testable components** while preserving all functionality, test coverage, and accessibility features.

Estimated effort: **6-8 weeks** for complete refactoring with testing.

**Priority order:**
1. Component extraction (enables parallel work on features)
2. Performance optimization (user-facing improvements)
3. Controller refactoring (code health)
4. Testing & documentation (long-term maintenance)
5. Enhancements (nice-to-haves)

Good luck, Codex! This codebase is solid. We're just making it easier to work with. 

---

**Last Updated:** 2026-08-19  
**Reviewer:** Ned (Code Puppy)  
**Contact:** Daniel (dsheph2@walmart.com)
