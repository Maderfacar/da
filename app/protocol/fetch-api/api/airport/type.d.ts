interface AirportHour {
  hour: number;
  forecastCount: number;
  terminal?: string;
}

interface AirportForecastData {
  date: string;
  hours: AirportHour[];
  totalForecast: number;
  peakHour: number;
  peakCount: number;
  sourceFile: string;
  updatedAt: number;
}

interface WeatherSummary {
  description: string;
  weatherCode: number;
  maxTemp: string;
  minTemp: string;
  rainProbability: string;
}
