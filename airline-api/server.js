/**
 * Airline REST API - Mock Server
 * Domain: Airlines
 * Auth: JWT Access Token (15min) + Refresh Token (7d)
 * Endpoints: 15 API calls covering flights, bookings, passengers, airports, payments
 */

const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const swaggerUi = require('swagger-ui-express');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const swaggerSpec = require('./swagger.json');

const app = express();
app.use(express.json());
app.use(cors());

// ─── Config ──────────────────────────────────────────────────────────────────
const ACCESS_SECRET = 'airline_access_secret_key_2024';
const REFRESH_SECRET = 'airline_refresh_secret_key_2024';
const ACCESS_EXPIRY = '15m';
const REFRESH_EXPIRY = '7d';

// ─── In-Memory Store ─────────────────────────────────────────────────────────
const refreshTokenStore = new Set();

const users = [
  {
    id: 'u001',
    email: 'admin@skyline.com',
    password: bcrypt.hashSync('Admin@1234', 10),
    role: 'admin',
    name: 'Admin User'
  },
  {
    id: 'u002',
    email: 'agent@skyline.com',
    password: bcrypt.hashSync('Agent@5678', 10),
    role: 'agent',
    name: 'Travel Agent'
  }
];

const airports = [
  { code: 'JFK', name: 'John F. Kennedy International', city: 'New York', country: 'USA', timezone: 'America/New_York' },
  { code: 'LAX', name: 'Los Angeles International', city: 'Los Angeles', country: 'USA', timezone: 'America/Los_Angeles' },
  { code: 'LHR', name: 'Heathrow Airport', city: 'London', country: 'UK', timezone: 'Europe/London' },
  { code: 'DXB', name: 'Dubai International', city: 'Dubai', country: 'UAE', timezone: 'Asia/Dubai' },
  { code: 'SIN', name: 'Changi Airport', city: 'Singapore', country: 'Singapore', timezone: 'Asia/Singapore' },
  { code: 'HND', name: 'Haneda Airport', city: 'Tokyo', country: 'Japan', timezone: 'Asia/Tokyo' },
  { code: 'CDG', name: 'Charles de Gaulle', city: 'Paris', country: 'France', timezone: 'Europe/Paris' },
  { code: 'SYD', name: 'Kingsford Smith Airport', city: 'Sydney', country: 'Australia', timezone: 'Australia/Sydney' }
];

const flights = [
  {
    id: 'FL001',
    flightNumber: 'SK101',
    airline: 'SkyLine Air',
    origin: 'JFK',
    destination: 'LHR',
    departureTime: '2024-08-15T08:00:00Z',
    arrivalTime: '2024-08-15T20:00:00Z',
    duration: 720,
    status: 'scheduled',
    aircraft: 'Boeing 777',
    totalSeats: 300,
    availableSeats: 142,
    classes: {
      economy: { price: 580, seats: 240, available: 98 },
      business: { price: 2400, seats: 48, available: 32 },
      first: { price: 6500, seats: 12, available: 12 }
    }
  },
  {
    id: 'FL002',
    flightNumber: 'SK205',
    airline: 'SkyLine Air',
    origin: 'LAX',
    destination: 'DXB',
    departureTime: '2024-08-16T22:30:00Z',
    arrivalTime: '2024-08-17T20:30:00Z',
    duration: 1080,
    status: 'scheduled',
    aircraft: 'Airbus A380',
    totalSeats: 500,
    availableSeats: 280,
    classes: {
      economy: { price: 720, seats: 400, available: 220 },
      business: { price: 3100, seats: 80, available: 48 },
      first: { price: 8200, seats: 20, available: 12 }
    }
  },
  {
    id: 'FL003',
    flightNumber: 'SK310',
    airline: 'SkyLine Air',
    origin: 'LHR',
    destination: 'SIN',
    departureTime: '2024-08-17T11:15:00Z',
    arrivalTime: '2024-08-18T06:15:00Z',
    duration: 780,
    status: 'scheduled',
    aircraft: 'Boeing 787',
    totalSeats: 280,
    availableSeats: 55,
    classes: {
      economy: { price: 890, seats: 200, available: 35 },
      business: { price: 3800, seats: 64, available: 18 },
      first: { price: 9500, seats: 16, available: 2 }
    }
  }
];

const passengers = [
  {
    id: 'P001',
    firstName: 'James',
    lastName: 'Wilson',
    email: 'james.wilson@email.com',
    phone: '+1-555-0101',
    passport: 'US1234567',
    nationality: 'American',
    dateOfBirth: '1985-03-12',
    frequentFlyerId: 'FF-JW-001',
    tier: 'gold'
  },
  {
    id: 'P002',
    firstName: 'Sarah',
    lastName: 'Chen',
    email: 'sarah.chen@email.com',
    phone: '+65-9876-5432',
    passport: 'SG9876543',
    nationality: 'Singaporean',
    dateOfBirth: '1990-07-22',
    frequentFlyerId: 'FF-SC-002',
    tier: 'silver'
  }
];

const bookings = [
  {
    id: 'BK001',
    pnr: 'SKYAB1',
    flightId: 'FL001',
    passengerId: 'P001',
    class: 'business',
    seatNumber: '14A',
    status: 'confirmed',
    fare: 2400,
    taxes: 312,
    totalAmount: 2712,
    baggageAllowance: '2x23kg',
    checkedIn: false,
    createdAt: '2024-07-01T10:30:00Z',
    meals: ['vegetarian']
  }
];

const seats = {
  FL001: {
    economy: [
      { number: '20A', status: 'available', type: 'window' },
      { number: '20B', status: 'occupied', type: 'middle' },
      { number: '20C', status: 'available', type: 'aisle' },
      { number: '21A', status: 'available', type: 'window' },
      { number: '21B', status: 'available', type: 'middle' }
    ],
    business: [
      { number: '5A', status: 'available', type: 'window' },
      { number: '5B', status: 'occupied', type: 'aisle' },
      { number: '6A', status: 'available', type: 'window' }
    ]
  },
  FL002: {
    economy: [
      { number: '30A', status: 'available', type: 'window' },
      { number: '30B', status: 'available', type: 'middle' },
      { number: '30C', status: 'available', type: 'aisle' }
    ]
  }
};

// ─── Middleware ───────────────────────────────────────────────────────────────
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer <token>

  if (!token) {
    return res.status(401).json({ error: 'Access token required', code: 'TOKEN_MISSING' });
  }

  jwt.verify(token, ACCESS_SECRET, (err, user) => {
    if (err) {
      if (err.name === 'TokenExpiredError') {
        return res.status(401).json({ error: 'Access token expired', code: 'TOKEN_EXPIRED' });
      }
      return res.status(403).json({ error: 'Invalid access token', code: 'TOKEN_INVALID' });
    }
    req.user = user;
    next();
  });
}

function generateTokens(user) {
  const payload = { id: user.id, email: user.email, role: user.role };
  const accessToken = jwt.sign(payload, ACCESS_SECRET, { expiresIn: ACCESS_EXPIRY });
  const refreshToken = jwt.sign(payload, REFRESH_SECRET, { expiresIn: REFRESH_EXPIRY });
  return { accessToken, refreshToken };
}

// ─── Swagger UI ───────────────────────────────────────────────────────────────
app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));
app.get('/api/openapi.json', (req, res) => res.json(swaggerSpec));

// ─── ENDPOINT 1: POST /api/auth/login ────────────────────────────────────────
app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required', code: 'VALIDATION_ERROR' });
  }

  const user = users.find(u => u.email === email);
  if (!user || !bcrypt.compareSync(password, user.password)) {
    return res.status(401).json({ error: 'Invalid credentials', code: 'INVALID_CREDENTIALS' });
  }

  const { accessToken, refreshToken } = generateTokens(user);
  refreshTokenStore.add(refreshToken);

  res.status(200).json({
    message: 'Login successful',
    user: { id: user.id, name: user.name, email: user.email, role: user.role },
    accessToken,
    refreshToken,
    expiresIn: 900 // 15 minutes in seconds
  });
});

// ─── ENDPOINT 2: POST /api/auth/refresh ──────────────────────────────────────
app.post('/api/auth/refresh', (req, res) => {
  const { refreshToken } = req.body;

  if (!refreshToken) {
    return res.status(400).json({ error: 'Refresh token required', code: 'TOKEN_MISSING' });
  }

  if (!refreshTokenStore.has(refreshToken)) {
    return res.status(403).json({ error: 'Refresh token revoked or invalid', code: 'TOKEN_REVOKED' });
  }

  jwt.verify(refreshToken, REFRESH_SECRET, (err, user) => {
    if (err) {
      refreshTokenStore.delete(refreshToken);
      return res.status(403).json({ error: 'Refresh token expired', code: 'TOKEN_EXPIRED' });
    }

    const userRecord = users.find(u => u.id === user.id);
    const { accessToken, refreshToken: newRefreshToken } = generateTokens(userRecord);

    // Rotate refresh token
    refreshTokenStore.delete(refreshToken);
    refreshTokenStore.add(newRefreshToken);

    res.status(200).json({
      message: 'Token refreshed successfully',
      accessToken,
      refreshToken: newRefreshToken,
      expiresIn: 900
    });
  });
});

// ─── ENDPOINT 3: POST /api/auth/logout ───────────────────────────────────────
app.post('/api/auth/logout', authenticateToken, (req, res) => {
  const { refreshToken } = req.body;
  if (refreshToken) refreshTokenStore.delete(refreshToken);
  res.status(200).json({ message: 'Logged out successfully' });
});

// ─── ENDPOINT 4: GET /api/airports ───────────────────────────────────────────
app.get('/api/airports', authenticateToken, (req, res) => {
  const { country, city } = req.query;
  let result = [...airports];

  if (country) result = result.filter(a => a.country.toLowerCase().includes(country.toLowerCase()));
  if (city) result = result.filter(a => a.city.toLowerCase().includes(city.toLowerCase()));

  res.status(200).json({ count: result.length, airports: result });
});

// ─── ENDPOINT 5: GET /api/airports/:code ─────────────────────────────────────
app.get('/api/airports/:code', authenticateToken, (req, res) => {
  const airport = airports.find(a => a.code === req.params.code.toUpperCase());
  if (!airport) {
    return res.status(404).json({ error: `Airport with code ${req.params.code} not found`, code: 'NOT_FOUND' });
  }
  res.status(200).json(airport);
});

// ─── ENDPOINT 6: GET /api/flights/search ─────────────────────────────────────
app.get('/api/flights/search', authenticateToken, (req, res) => {
  const { origin, destination, date, class: cabinClass } = req.query;
  const startTime = Date.now();

  if (!origin || !destination) {
    return res.status(400).json({ error: 'Origin and destination are required', code: 'VALIDATION_ERROR' });
  }

  let results = flights.filter(f =>
    f.origin === origin.toUpperCase() &&
    f.destination === destination.toUpperCase()
  );

  if (date) {
    results = results.filter(f => f.departureTime.startsWith(date));
  }

  if (cabinClass) {
    results = results.filter(f => f.classes[cabinClass] && f.classes[cabinClass].available > 0);
  }

  const responseTime = Date.now() - startTime;
  res.status(200).json({
    count: results.length,
    flights: results,
    meta: { responseTimeMs: responseTime, searchedAt: new Date().toISOString() }
  });
});

// ─── ENDPOINT 7: GET /api/flights/:id ────────────────────────────────────────
app.get('/api/flights/:id', authenticateToken, (req, res) => {
  const flight = flights.find(f => f.id === req.params.id);
  if (!flight) {
    return res.status(404).json({ error: `Flight ${req.params.id} not found`, code: 'NOT_FOUND' });
  }
  res.status(200).json(flight);
});

// ─── ENDPOINT 8: GET /api/seats/:flightId ────────────────────────────────────
app.get('/api/seats/:flightId', authenticateToken, (req, res) => {
  const flightSeats = seats[req.params.flightId];
  if (!flightSeats) {
    return res.status(404).json({ error: `No seat data for flight ${req.params.flightId}`, code: 'NOT_FOUND' });
  }

  const { class: cabinClass } = req.query;
  const result = cabinClass ? { [cabinClass]: flightSeats[cabinClass] || [] } : flightSeats;

  res.status(200).json({ flightId: req.params.flightId, seats: result });
});

// ─── ENDPOINT 9: POST /api/passengers ────────────────────────────────────────
app.post('/api/passengers', authenticateToken, (req, res) => {
  const { firstName, lastName, email, phone, passport, nationality, dateOfBirth } = req.body;

  if (!firstName || !lastName || !email || !passport) {
    return res.status(400).json({
      error: 'firstName, lastName, email, and passport are required',
      code: 'VALIDATION_ERROR'
    });
  }

  if (passengers.find(p => p.passport === passport)) {
    return res.status(409).json({ error: 'Passenger with this passport already exists', code: 'DUPLICATE' });
  }

  const newPassenger = {
    id: `P${String(passengers.length + 1).padStart(3, '0')}`,
    firstName, lastName, email, phone, passport, nationality, dateOfBirth,
    frequentFlyerId: `FF-${firstName.substring(0, 2).toUpperCase()}${lastName.substring(0, 2).toUpperCase()}-${Date.now()}`,
    tier: 'bronze',
    createdAt: new Date().toISOString()
  };

  passengers.push(newPassenger);
  res.status(201).json({ message: 'Passenger created successfully', passenger: newPassenger });
});

// ─── ENDPOINT 10: GET /api/passengers/:id ────────────────────────────────────
app.get('/api/passengers/:id', authenticateToken, (req, res) => {
  const passenger = passengers.find(p => p.id === req.params.id);
  if (!passenger) {
    return res.status(404).json({ error: `Passenger ${req.params.id} not found`, code: 'NOT_FOUND' });
  }
  res.status(200).json(passenger);
});

// ─── ENDPOINT 11: POST /api/bookings ─────────────────────────────────────────
app.post('/api/bookings', authenticateToken, (req, res) => {
  const { flightId, passengerId, class: cabinClass, seatNumber, meals } = req.body;

  if (!flightId || !passengerId || !cabinClass) {
    return res.status(400).json({
      error: 'flightId, passengerId, and class are required',
      code: 'VALIDATION_ERROR'
    });
  }

  const flight = flights.find(f => f.id === flightId);
  if (!flight) return res.status(404).json({ error: 'Flight not found', code: 'NOT_FOUND' });

  const passenger = passengers.find(p => p.id === passengerId);
  if (!passenger) return res.status(404).json({ error: 'Passenger not found', code: 'NOT_FOUND' });

  const cabinInfo = flight.classes[cabinClass];
  if (!cabinInfo || cabinInfo.available === 0) {
    return res.status(409).json({ error: `No seats available in ${cabinClass} class`, code: 'NO_AVAILABILITY' });
  }

  const taxes = Math.round(cabinInfo.price * 0.13);
  const newBooking = {
    id: `BK${String(bookings.length + 1).padStart(3, '0')}`,
    pnr: `SKY${Math.random().toString(36).substring(2, 7).toUpperCase()}`,
    flightId, passengerId,
    class: cabinClass,
    seatNumber: seatNumber || null,
    status: 'confirmed',
    fare: cabinInfo.price,
    taxes,
    totalAmount: cabinInfo.price + taxes,
    baggageAllowance: cabinClass === 'economy' ? '1x23kg' : cabinClass === 'business' ? '2x23kg' : '3x32kg',
    checkedIn: false,
    meals: meals || [],
    createdAt: new Date().toISOString()
  };

  bookings.push(newBooking);
  cabinInfo.available -= 1;
  flight.availableSeats -= 1;

  res.status(201).json({ message: 'Booking confirmed', booking: newBooking });
});

// ─── ENDPOINT 12: GET /api/bookings/:id ──────────────────────────────────────
app.get('/api/bookings/:id', authenticateToken, (req, res) => {
  const booking = bookings.find(b => b.id === req.params.id);
  if (!booking) {
    return res.status(404).json({ error: `Booking ${req.params.id} not found`, code: 'NOT_FOUND' });
  }

  const flight = flights.find(f => f.id === booking.flightId);
  const passenger = passengers.find(p => p.id === booking.passengerId);

  res.status(200).json({ ...booking, flightDetails: flight, passengerDetails: passenger });
});

// ─── ENDPOINT 13: PUT /api/bookings/:id/cancel ───────────────────────────────
app.put('/api/bookings/:id/cancel', authenticateToken, (req, res) => {
  const booking = bookings.find(b => b.id === req.params.id);
  if (!booking) {
    return res.status(404).json({ error: `Booking ${req.params.id} not found`, code: 'NOT_FOUND' });
  }

  if (booking.status === 'cancelled') {
    return res.status(409).json({ error: 'Booking already cancelled', code: 'ALREADY_CANCELLED' });
  }

  if (booking.checkedIn) {
    return res.status(403).json({ error: 'Cannot cancel a checked-in booking', code: 'OPERATION_NOT_ALLOWED' });
  }

  booking.status = 'cancelled';
  booking.cancelledAt = new Date().toISOString();

  const flight = flights.find(f => f.id === booking.flightId);
  if (flight) {
    flight.classes[booking.class].available += 1;
    flight.availableSeats += 1;
  }

  const refundAmount = Math.round(booking.totalAmount * 0.85); // 15% cancellation fee
  res.status(200).json({
    message: 'Booking cancelled successfully',
    booking,
    refund: { amount: refundAmount, currency: 'USD', processingDays: 5 }
  });
});

// ─── ENDPOINT 14: POST /api/check-in ─────────────────────────────────────────
app.post('/api/check-in', authenticateToken, (req, res) => {
  const { bookingId, seatPreference, baggageCount } = req.body;

  if (!bookingId) {
    return res.status(400).json({ error: 'bookingId is required', code: 'VALIDATION_ERROR' });
  }

  const booking = bookings.find(b => b.id === bookingId);
  if (!booking) return res.status(404).json({ error: 'Booking not found', code: 'NOT_FOUND' });
  if (booking.status === 'cancelled') return res.status(409).json({ error: 'Cannot check in a cancelled booking', code: 'INVALID_STATUS' });
  if (booking.checkedIn) return res.status(409).json({ error: 'Already checked in', code: 'ALREADY_CHECKED_IN' });

  booking.checkedIn = true;
  booking.checkInTime = new Date().toISOString();
  booking.seatNumber = booking.seatNumber || (seatPreference === 'window' ? '22A' : '22C');
  booking.boardingPass = {
    pnr: booking.pnr,
    seat: booking.seatNumber,
    gate: `G${Math.floor(Math.random() * 30) + 1}`,
    boardingTime: '07:30',
    barcode: Buffer.from(booking.pnr + booking.seatNumber).toString('base64')
  };

  res.status(200).json({
    message: 'Check-in successful',
    booking,
    boardingPass: booking.boardingPass
  });
});

// ─── ENDPOINT 15: POST /api/payments ─────────────────────────────────────────
app.post('/api/payments', authenticateToken, (req, res) => {
  const { bookingId, paymentMethod, cardLast4, amount } = req.body;

  if (!bookingId || !paymentMethod || !amount) {
    return res.status(400).json({
      error: 'bookingId, paymentMethod, and amount are required',
      code: 'VALIDATION_ERROR'
    });
  }

  const booking = bookings.find(b => b.id === bookingId);
  if (!booking) return res.status(404).json({ error: 'Booking not found', code: 'NOT_FOUND' });

  if (amount < booking.totalAmount) {
    return res.status(400).json({
      error: `Insufficient payment. Expected: ${booking.totalAmount}, received: ${amount}`,
      code: 'INSUFFICIENT_PAYMENT'
    });
  }

  const payment = {
    id: `PAY${uuidv4().substring(0, 8).toUpperCase()}`,
    bookingId,
    amount,
    currency: 'USD',
    paymentMethod,
    cardLast4: cardLast4 || null,
    status: 'success',
    transactionId: uuidv4(),
    processedAt: new Date().toISOString()
  };

  res.status(201).json({ message: 'Payment processed successfully', payment });
});

// ─── GET /api/baggage/allowance ───────────────────────────────────────────────
app.get('/api/baggage/allowance', authenticateToken, (req, res) => {
  const { class: cabinClass, route } = req.query;

  const allowances = {
    economy: { checkedBags: 1, weightPerBag: '23kg', handBaggage: '7kg', excessFee: 60 },
    business: { checkedBags: 2, weightPerBag: '23kg', handBaggage: '12kg', excessFee: 0 },
    first: { checkedBags: 3, weightPerBag: '32kg', handBaggage: '14kg', excessFee: 0 }
  };

  if (cabinClass && !allowances[cabinClass]) {
    return res.status(400).json({ error: `Invalid class: ${cabinClass}`, code: 'VALIDATION_ERROR' });
  }

  const result = cabinClass ? { [cabinClass]: allowances[cabinClass] } : allowances;
  res.status(200).json({ allowances: result, currency: 'USD' });
});

// ─── Health Check ─────────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'healthy',
    service: 'SkyLine Airline API',
    version: '1.0.0',
    timestamp: new Date().toISOString()
  });
});

// ─── 404 Handler ─────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ error: `Route ${req.method} ${req.path} not found`, code: 'ROUTE_NOT_FOUND' });
});

// ─── Start Server ─────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n✈  SkyLine Airline API running on http://localhost:${PORT}`);
  console.log(`📖  Swagger Docs: http://localhost:${PORT}/api/docs`);
  console.log(`📋  OpenAPI JSON: http://localhost:${PORT}/api/openapi.json\n`);
  console.log('Default credentials:');
  console.log('  admin@skyline.com / Admin@1234');
  console.log('  agent@skyline.com / Agent@5678\n');
});

module.exports = app;
