-- التوظيف (الشواغر والمتقدمون والمقابلات)، والخدمات الإدارية (الصيانة وحجز القاعات)، وطلب عروض الأسعار وتقييم المورّدين
CREATE TABLE hr_vacancies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  unit_id INTEGER REFERENCES org_units(id),
  positions INTEGER NOT NULL DEFAULT 1 CHECK (positions > 0),
  description TEXT NOT NULL DEFAULT '',
  requirements TEXT NOT NULL DEFAULT '',
  closes_on TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed', 'filled')),
  created_by INTEGER,
  created_at INTEGER NOT NULL
);
CREATE TABLE hr_applicants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vacancy_id INTEGER NOT NULL REFERENCES hr_vacancies(id),
  full_name TEXT NOT NULL,
  national_id TEXT NOT NULL,
  phone TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  qualification TEXT NOT NULL DEFAULT '',
  experience_years INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'applied' CHECK (status IN ('applied', 'shortlisted', 'interview', 'offered', 'hired', 'rejected')),
  note TEXT NOT NULL DEFAULT '',
  employee_id INTEGER REFERENCES hr_employees(id),
  created_by INTEGER,
  created_at INTEGER NOT NULL,
  UNIQUE (vacancy_id, national_id)
);
CREATE TABLE hr_interviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  applicant_id INTEGER NOT NULL REFERENCES hr_applicants(id),
  scheduled_at BIGINT NOT NULL,
  panel TEXT NOT NULL DEFAULT '',
  score INTEGER CHECK (score BETWEEN 0 AND 100),
  recommendation TEXT CHECK (recommendation IN ('hire', 'reserve', 'reject')),
  notes TEXT NOT NULL DEFAULT '',
  created_by INTEGER,
  created_at INTEGER NOT NULL
);

CREATE TABLE facility_rooms (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  building TEXT NOT NULL DEFAULT '',
  capacity INTEGER NOT NULL DEFAULT 0,
  kind TEXT NOT NULL DEFAULT 'hall',
  active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);
CREATE TABLE room_bookings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  room_id INTEGER NOT NULL REFERENCES facility_rooms(id),
  title TEXT NOT NULL,
  day TEXT NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  attendees INTEGER NOT NULL DEFAULT 0,
  requester_id INTEGER NOT NULL REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  decided_by INTEGER,
  decision_note TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  CHECK (end_time > start_time)
);
CREATE INDEX idx_room_bookings_room_day ON room_bookings(room_id, day, status);
CREATE TABLE maintenance_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  no TEXT NOT NULL UNIQUE,
  location TEXT NOT NULL,
  category TEXT NOT NULL,
  description TEXT NOT NULL,
  priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('normal', 'urgent', 'emergency')),
  requester_id INTEGER NOT NULL REFERENCES users(id),
  assignee_id INTEGER REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'assigned', 'done', 'closed', 'cancelled')),
  done_note TEXT NOT NULL DEFAULT '',
  cost INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  assigned_at INTEGER,
  done_at INTEGER,
  closed_at INTEGER
);
CREATE INDEX idx_maintenance_status ON maintenance_orders(status, priority);

CREATE TABLE proc_rfqs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  no TEXT NOT NULL UNIQUE,
  request_id INTEGER NOT NULL REFERENCES proc_requests(id),
  title TEXT NOT NULL,
  closes_on TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'awarded', 'cancelled')),
  awarded_quote_id INTEGER,
  award_note TEXT NOT NULL DEFAULT '',
  order_id INTEGER REFERENCES proc_orders(id),
  created_by INTEGER,
  created_at INTEGER NOT NULL
);
CREATE TABLE proc_rfq_quotes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rfq_id INTEGER NOT NULL REFERENCES proc_rfqs(id),
  supplier_id INTEGER NOT NULL REFERENCES proc_suppliers(id),
  delivery_days INTEGER NOT NULL DEFAULT 0,
  total INTEGER NOT NULL DEFAULT 0,
  notes TEXT NOT NULL DEFAULT '',
  created_by INTEGER,
  created_at INTEGER NOT NULL,
  UNIQUE (rfq_id, supplier_id)
);
CREATE TABLE proc_rfq_quote_lines (
  quote_id INTEGER NOT NULL REFERENCES proc_rfq_quotes(id) ON DELETE CASCADE,
  request_line_id INTEGER NOT NULL REFERENCES proc_request_lines(id),
  unit_price INTEGER NOT NULL CHECK (unit_price >= 0),
  PRIMARY KEY (quote_id, request_line_id)
);
CREATE TABLE proc_supplier_ratings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  supplier_id INTEGER NOT NULL REFERENCES proc_suppliers(id),
  order_id INTEGER NOT NULL REFERENCES proc_orders(id),
  quality INTEGER NOT NULL CHECK (quality BETWEEN 1 AND 5),
  timeliness INTEGER NOT NULL CHECK (timeliness BETWEEN 1 AND 5),
  price INTEGER NOT NULL CHECK (price BETWEEN 1 AND 5),
  note TEXT NOT NULL DEFAULT '',
  rated_by INTEGER,
  created_at INTEGER NOT NULL,
  UNIQUE (order_id)
);
