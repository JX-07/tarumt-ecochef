let returnListener: ((date: string | undefined) => void) | undefined;

export function registerShoppingReturn(listener: (date: string | undefined) => void) {
  returnListener = listener;
  return () => {
    if (returnListener === listener) returnListener = undefined;
  };
}

export function requestShoppingReturn(date?: string) {
  returnListener?.(date);
}
