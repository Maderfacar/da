interface UpdateLocationParams {
  lat: number;
  lng: number;
  heading?: number;
  status?: 'online' | 'offline' | 'busy';
  displayName?: string;
}

interface DriverInfo {
  driverId: string;
  displayName: string;
  status: 'online' | 'busy';
  lat: number;
  lng: number;
  heading: number | null;
  updatedAt: number;
}

interface DriverStats {
  tripsToday: number;
  earningsToday: number;
}
