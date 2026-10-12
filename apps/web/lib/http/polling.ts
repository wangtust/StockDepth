// SWR pauses its interval while hidden/offline and deduplicates shared keys.
export const pollingDefaults = {
  dedupingInterval: 2000,
  refreshWhenHidden: false,
  refreshWhenOffline: false,
  revalidateOnFocus: true,
  errorRetryCount: 3,
  errorRetryInterval: 5000
};
