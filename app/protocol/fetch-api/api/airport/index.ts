import methods from '@/protocol/fetch-api/methods';

export const GetAirportForecast = (params: { date?: string } = {}) =>
  methods.get<AirportForecastData>('/nuxt-api/airport-forecast', params);

export const GetWeather = (params: { dataset?: string; locationName?: string } = {}) =>
  methods.get<unknown>('/nuxt-api/weather', {
    dataset: 'F-C0032-001',
    locationName: '桃園市',
    ...params,
  });
