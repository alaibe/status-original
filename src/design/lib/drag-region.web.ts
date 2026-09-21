// react-native-web writes `dataSet` out as data-* attributes; Tauri starts a
// window drag on mousedown when the element under the pointer carries this one.
export const DRAG_REGION: Record<string, unknown> = { dataSet: { tauriDragRegion: '' } };
