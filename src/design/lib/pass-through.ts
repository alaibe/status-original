import { StyleSheet } from 'react-native';

/** The desktop honours `box-none` only from a compiled style: inline it is not valid CSS. */
export const PASS_THROUGH = StyleSheet.create({ view: { pointerEvents: 'box-none' } }).view;
