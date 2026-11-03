// A touch and hold that does something (the tab count's new tab) runs when the finger lifts, not
// the moment the hold is recognised. Android's back gesture starts as a touch on whatever is under
// the finger: a swipe in from the screen's edge that rests a moment first is a hold on the button
// there, and the tab count opened a new tab (and focused its address) as the back went through.
// The system cancels the touch once it takes it for its gesture, so a cancelled hold runs nothing.
export interface Hold {
  start: () => void // the finger went down
  held: () => void // the press lasted long enough to be a hold
  end: () => void // the finger lifted: runs the action if this touch was a hold
  cancel: () => void // the system (or a scroll) took the touch
}

export function createHold (run: () => void): Hold {
  let held = false
  return {
    start: () => { held = false },
    held: () => { held = true },
    end: () => {
      if (!held) return
      held = false
      run()
    },
    cancel: () => { held = false }
  }
}
