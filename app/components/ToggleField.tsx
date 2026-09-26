import { useState } from "react";

type ToggleState = {
  /** What the form submits while the switch is in this position. */
  value: string;
  /** Shown beside the switch. */
  label: string;
  /** Shown under it while the switch is in this position. */
  hint?: string;
};

/**
 * The design system's toggle (a `role="switch"` pill with the current state beside
 * it) for a two-state field. Unlike the design's stand-alone toggle it does not apply
 * at once: it lives in a form, so the choice is submitted under `name` (hidden input)
 * and saved with the form's own button.
 */
export function ToggleField({
  name,
  label,
  on,
  off,
  defaultOn,
}: {
  name: string;
  label: string;
  on: ToggleState;
  off: ToggleState;
  defaultOn: boolean;
}) {
  const [isOn, setIsOn] = useState(defaultOn);
  const state = isOn ? on : off;
  const labelId = `${name}-label`;
  const stateId = `${name}-state`;

  return (
    <div className="toggle-field">
      <span id={labelId} className="toggle-field__label">
        {label}
      </span>
      <input type="hidden" name={name} value={state.value} />
      <button
        type="button"
        role="switch"
        aria-checked={isOn}
        aria-labelledby={`${labelId} ${stateId}`}
        className={`toggle-field__switch${isOn ? " toggle-field__switch--on" : ""}`}
        onClick={() => setIsOn((v) => !v)}
      >
        <span className="toggle-field__track">
          <span className="toggle-field__knob" />
        </span>
        <span id={stateId} className="toggle-field__state">
          {state.label}
        </span>
      </button>
      {state.hint ? <p className="toggle-field__hint">{state.hint}</p> : null}
    </div>
  );
}
