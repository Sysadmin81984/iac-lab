const express = require('express');
const path = require('path');
const { Pool } = require('pg');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

const app = express();
app.use(express.json());

// Підключення до бази даних PostgreSQL
const pool = new Pool({
  host: process.env.DB_HOST || 'postgres-primary',
  user: process.env.DB_USER || 'db_user',
  password: process.env.DB_PASSWORD || 'supersecretpassword',
  database: process.env.DB_NAME || 'main_db',
  port: 5432
});

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-key';

// Автоматична ініціалізація БД (створення таблиць та тестового адміна)
async function initDB() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(50) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        role VARCHAR(20) DEFAULT 'admin'
      );

      CREATE TABLE IF NOT EXISTS products (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        price NUMERIC(10, 2) NOT NULL,
        stock INT NOT NULL DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS orders (
        id SERIAL PRIMARY KEY,
        customer_name VARCHAR(100) NOT NULL,
        customer_phone VARCHAR(20) NOT NULL,
        delivery_address TEXT,
        product_id INT REFERENCES products(id) ON DELETE CASCADE,
        quantity INT NOT NULL,
        status VARCHAR(20) DEFAULT 'pending',
        form_type VARCHAR(20) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Перевірка наявності адміна
    const adminCheck = await pool.query("SELECT * FROM users WHERE username = 'admin'");
    if (adminCheck.rows.length === 0) {
      const defaultPasswordHash = await bcrypt.hash('admin123', 10);
      await pool.query(
        "INSERT INTO users (username, password_hash, role) VALUES ('admin', $1, 'admin')",
        [defaultPasswordHash]
      );
      console.log('Створено дефолтного адміністратора: admin / admin123');
    }

    // Перевірка наявності тестових товарів
    const prodCheck = await pool.query('SELECT COUNT(*) FROM products');
    if (parseInt(prodCheck.rows[0].count) === 0) {
      await pool.query(`
        INSERT INTO products (name, price, stock) VALUES 
        ('Ноутбук Lenovo IdeaPad', 24999.00, 10),
        ('Смартфон Samsung Galaxy', 18500.00, 15),
        ('Навушники Sony WH-1000XM4', 11200.00, 20);
      `);
      console.log('Додано базовий асортимент товарів.');
    }
  } catch (err) {
    console.error('Помилка ініціалізації БД:', err.message);
  }
}

// Маршрутизація сторінок на основі HTTP Host Header
app.use((req, res, next) => {
  const host = req.headers.host || '';
  if (req.path === '/' || req.path === '/index.html') {
    if (host.includes('express')) {
      return res.sendFile(path.join(__dirname, '../public/express.html'));
    } else if (host.includes('admin')) {
      return res.sendFile(path.join(__dirname, '../public/admin.html'));
    } else {
      return res.sendFile(path.join(__dirname, '../public/shop.html'));
    }
  }
  next();
});

app.use(express.static(path.join(__dirname, '../public')));

// Middleware авторизації
const authenticateAdmin = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: 'Необхідна авторизація' });
  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.role !== 'admin') return res.status(403).json({ error: 'Доступ заборонено' });
    req.user = decoded;
    next();
  } catch (err) {
    res.status(401).json({ error: 'Недійсний токен' });
  }
};

// REST API
app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body;
  try {
    const result = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
    if (result.rows.length === 0) return res.status(400).json({ error: 'Невірний логін або пароль' });

    const user = result.rows[0];
    const validPass = await bcrypt.compare(password, user.password_hash);
    if (!validPass) return res.status(400).json({ error: 'Невірний логін або пароль' });

    const token = jwt.sign({ id: user.id, username: user.username, role: user.role }, JWT_SECRET, { expiresIn: '8h' });
    res.json({ token });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/products', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM products ORDER BY id DESC');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/products', authenticateAdmin, async (req, res) => {
  const { name, price, stock } = req.body;
  try {
    const result = await pool.query(
      'INSERT INTO products (name, price, stock) VALUES ($1, $2, $3) RETURNING *',
      [name, price, stock]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/admin/products/:id', authenticateAdmin, async (req, res) => {
  try {
    await pool.query('DELETE FROM products WHERE id = $1', [req.params.id]);
    res.json({ message: 'Товар видалено' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/admin/orders', authenticateAdmin, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT o.id, o.customer_name, o.customer_phone, o.delivery_address, 
             p.name as product_name, o.quantity, o.form_type, o.created_at
      FROM orders o 
      LEFT JOIN products p ON o.product_id = p.id 
      ORDER BY o.created_at DESC
    `);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/orders/express', async (req, res) => {
  const { customer_name, customer_phone, product_id } = req.body;
  try {
    const result = await pool.query(
      'INSERT INTO orders (customer_name, customer_phone, product_id, quantity, form_type) VALUES ($1, $2, $3, 1, $4) RETURNING *',
      [customer_name, customer_phone, product_id, 'express']
    );
    res.json({ success: true, order: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/orders/detailed', async (req, res) => {
  const { customer_name, customer_phone, delivery_address, product_id, quantity } = req.body;
  try {
    const result = await pool.query(
      'INSERT INTO orders (customer_name, customer_phone, delivery_address, product_id, quantity, form_type) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
      [customer_name, customer_phone, delivery_address, product_id, quantity || 1, 'detailed']
    );
    res.json({ success: true, order: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  console.log(`Server listening on port ${PORT}`);
  await initDB();
});
