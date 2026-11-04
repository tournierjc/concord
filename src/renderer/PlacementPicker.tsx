/**
 * PlacementPicker.tsx — les 12 emplacements, dessinés comme un écran miniature.
 *
 * Chaque bouton est une barre à l’endroit réel du bord (rangée ou colonne).
 * Un seul est pressé. Le clic enregistre tout de suite et oublie un glisser.
 */

import type { CSSProperties } from 'react';

import {
  OVERLAY_PICKER_SLOTS,
  pickerBarStyle,
  samePlacement,
  type OverlayPlacement,
} from '../shell/overlay-geometry';
import type { Translate } from './i18n';

export interface PlacementPickerProps {
  value: OverlayPlacement;
  onSelect: (placement: OverlayPlacement) => void;
  t: Translate;
}

function labelFor(t: Translate, placement: OverlayPlacement): string {
  switch (placement.flow) {
    case 'horizontal':
      switch (placement.anchor) {
        case 'top-left':
          return t('settings.overlay.placement.horizontal.topLeft');
        case 'top-center':
          return t('settings.overlay.placement.horizontal.topCenter');
        case 'top-right':
          return t('settings.overlay.placement.horizontal.topRight');
        case 'bottom-left':
          return t('settings.overlay.placement.horizontal.bottomLeft');
        case 'bottom-center':
          return t('settings.overlay.placement.horizontal.bottomCenter');
        case 'bottom-right':
          return t('settings.overlay.placement.horizontal.bottomRight');
        default:
          return t('settings.overlay.placement.horizontal.topRight');
      }
    case 'vertical':
      switch (placement.anchor) {
        case 'top-left':
          return t('settings.overlay.placement.vertical.topLeft');
        case 'center-left':
          return t('settings.overlay.placement.vertical.centerLeft');
        case 'bottom-left':
          return t('settings.overlay.placement.vertical.bottomLeft');
        case 'top-right':
          return t('settings.overlay.placement.vertical.topRight');
        case 'center-right':
          return t('settings.overlay.placement.vertical.centerRight');
        case 'bottom-right':
          return t('settings.overlay.placement.vertical.bottomRight');
        default:
          return t('settings.overlay.placement.vertical.topLeft');
      }
    default:
      return t('settings.overlay.placement.horizontal.topRight');
  }
}

export function PlacementPicker({ value, onSelect, t }: PlacementPickerProps): JSX.Element {
  return (
    <div className="placement-screen" role="group" aria-label={t('settings.overlay.placement')}>
      {OVERLAY_PICKER_SLOTS.map((placement) => {
        const pressed = samePlacement(placement, value);
        const label = labelFor(t, placement);
        return (
          <button
            key={`${placement.flow}-${placement.anchor}`}
            type="button"
            className="placement-screen__bar"
            data-flow={placement.flow}
            data-anchor={placement.anchor}
            style={pickerBarStyle(placement) as CSSProperties}
            aria-pressed={pressed}
            aria-label={label}
            title={label}
            onClick={() => onSelect(placement)}
          />
        );
      })}
    </div>
  );
}
