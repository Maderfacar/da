import mitt from 'mitt';

export default defineNuxtPlugin(() => {
  const emitter = mitt<MittEvent>();
  return { provide: { emitter } };
});
