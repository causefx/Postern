import { h } from '../../lib/h.js';
import { Button } from '../common/Button.js';

/** Stepper, presets, and the Use default button for one setting. */
export function SettingControls({
  field,
  label,
  value,
  min,
  max,
  presets,
  note,
  detail,
  fieldName,
  isDefault,
  onChange,
  onDefault,
}) {
  function step(button, delta) {
    const input = button.parentElement?.querySelector('[data-input]');
    const current = Number(input?.value);
    onChange((Number.isFinite(current) ? current : value) + delta);
  }

  return h(
    'div',
    { className: 'settings-controls' },
    h(
      'div',
      { className: 'settings-input-row' },
      h(
      'div',
      { className: 'settings-stepper', role: 'group', 'aria-label': label },
      h(
        'button',
        {
          type: 'button',
          className: 'settings-step',
          'aria-label': `Decrease ${label}`,
          disabled: value <= min,
          onClick: (e) => step(e.currentTarget, -1),
        },
        '−',
      ),
      h('input', {
        className: 'settings-step-value',
        inputmode: 'numeric',
        'aria-label': label,
        'data-input': field,
        value: String(value),
        onInput: (e) => {
          const raw = e.target.value.trim();
          if (!/^\d+$/.test(raw)) return;
          onChange(Number(raw));
        },
        onBlur: (e) => onChange(e.target.value),
      }),
      h(
        'button',
        {
          type: 'button',
          className: 'settings-step',
          'aria-label': `Increase ${label}`,
          disabled: value >= max,
          onClick: (e) => step(e.currentTarget, 1),
        },
        '+',
      ),
    ),
    h(
      'div',
      { className: 'settings-presets', role: 'group', 'aria-label': `${label} presets` },
      ...presets.map((preset) =>
        h(
          'button',
          {
            type: 'button',
            className: preset.value === value ? 'settings-preset is-active' : 'settings-preset',
            'data-preset': field,
            'data-value': String(preset.value),
            'aria-pressed': preset.value === value ? 'true' : 'false',
            onClick: () => onChange(preset.value),
          },
          preset.label,
        ),
      ),
    ),
    ),
    h('p', { className: 'settings-note', 'data-note': field }, note),
    h('p', { className: 'settings-detail' }, detail),
    h(
      'div',
      { className: 'settings-field-row' },
      h('span', { className: 'settings-field-name' }, fieldName),
      Button(
        {
          size: 'sm',
          className: 'btn-outline',
          'data-default': field,
          disabled: isDefault,
          onClick: onDefault,
        },
        'Use default',
      ),
    ),
  );
}
