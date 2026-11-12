# Shared theme

The cross-platform visual source of truth is `packages/design-tokens`: import its `colors`, `palette`, `typography` and spacing tokens instead of redeclaring values in a feature.

Import `Text` and `TextInput` from `src/shared/components/themed-text` (using the appropriate relative path). These components apply the declared platform font and preserve native refs and props. Add intentional font overrides to shared typography first; keep feature layouts local.
