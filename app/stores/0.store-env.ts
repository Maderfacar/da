export const StoreEnv = defineStore('StoreEnv', () => {
  const runtimeConfig = useRuntimeConfig();
  const env = ref({
    apiBase: import.meta.server ? (runtimeConfig.apiBase ?? '') : '',
  });

  return { env };
});
