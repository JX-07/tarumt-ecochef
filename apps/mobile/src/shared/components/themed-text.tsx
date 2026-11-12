import React, { forwardRef } from "react";
import { Platform, Text as NativeText, TextInput as NativeTextInput, type TextProps, type TextInputProps } from "react-native";
import { typography } from "@ecochef/design-tokens";

const font = { fontFamily: Platform.select(typography.nativeFontFamily) };
export const Text = forwardRef<React.ComponentRef<typeof NativeText>, TextProps>((props, ref) => <NativeText {...props} ref={ref} style={[font, props.style]} />);
export const TextInput = forwardRef<React.ComponentRef<typeof NativeTextInput>, TextInputProps>((props, ref) => <NativeTextInput {...props} ref={ref} style={[font, props.style]} />);
Text.displayName = "ThemedText";
TextInput.displayName = "ThemedTextInput";
