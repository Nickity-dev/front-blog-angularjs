require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { pool, init } = require('./db');

const SECRET = process.env.JWT_SECRET || 'troque-esta-chave-em-producao';
const app = express();

app.use(cors({ origin: process.env.FRONTEND_URL || '*' }));
app.use(express.json());

const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);

function auth(req, res, next) {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  try {
    req.user = jwt.verify(token, SECRET);
    next();
  } catch {
    res.status(401).json({ erro: 'Não autenticado' });
  }
}

const gerarToken = (u) =>
  jwt.sign({ id: u.id, name: u.name }, SECRET, { expiresIn: '7d' });

app.get('/', (req, res) => res.json({ status: 'API do blog no ar' }));

// ---------- CADASTRO ----------
app.post('/auth/register', wrap(async (req, res) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password || password.length < 6)
    return res.status(400).json({ erro: 'Preencha tudo (senha mínima: 6 caracteres)' });

  const existe = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
  if (existe.rows.length) return res.status(409).json({ erro: 'E-mail já cadastrado' });

  const hash = bcrypt.hashSync(password, 10);
  const info = await pool.query(
    'INSERT INTO users (name, email, password) VALUES ($1, $2, $3) RETURNING id',
    [name, email, hash]
  );

  const user = { id: info.rows[0].id, name };
  res.status(201).json({ token: gerarToken(user), user });
}));

// ---------- LOGIN ----------
app.post('/auth/login', wrap(async (req, res) => {
  const { email, password } = req.body;
  const result = await pool.query('SELECT * FROM users WHERE email = $1', [email || '']);
  const u = result.rows[0];
  if (!u || !bcrypt.compareSync(password || '', u.password))
    return res.status(401).json({ erro: 'E-mail ou senha inválidos' });

  const user = { id: u.id, name: u.name };
  res.json({ token: gerarToken(user), user });
}));

// ---------- POSTS ----------
app.get('/postagens', wrap(async (req, res) => {
  const result = await pool.query(
    `SELECT p.*, u.name AS author FROM posts p
     JOIN users u ON u.id = p.user_id ORDER BY p.id DESC`
  );
  res.json(result.rows);
}));

app.get('/postagens/:id', wrap(async (req, res) => {
  const result = await pool.query(
    `SELECT p.*, u.name AS author FROM posts p
     JOIN users u ON u.id = p.user_id WHERE p.id = $1`,
    [req.params.id]
  );
  if (!result.rows.length) return res.status(404).json({ erro: 'Postagem não encontrada' });
  res.json(result.rows[0]);
}));

app.post('/postagens', auth, wrap(async (req, res) => {
  const { title, description, content, thumbImage } = req.body;
  if (!title || !description || !content)
    return res.status(400).json({ erro: 'Título, descrição e conteúdo são obrigatórios' });

  const info = await pool.query(
    `INSERT INTO posts (user_id, title, description, content, "thumbImage")
     VALUES ($1,$2,$3,$4,$5) RETURNING id`,
    [req.user.id, title, description, content, thumbImage || '']
  );
  res.status(201).json({ id: info.rows[0].id });
}));

app.put('/postagens/:id', auth, wrap(async (req, res) => {
  const result = await pool.query('SELECT * FROM posts WHERE id = $1', [req.params.id]);
  const post = result.rows[0];
  if (!post) return res.status(404).json({ erro: 'Postagem não encontrada' });
  if (post.user_id !== req.user.id) return res.status(403).json({ erro: 'Sem permissão' });

  const { title, description, content, thumbImage } = req.body;
  if (!title || !description || !content)
    return res.status(400).json({ erro: 'Título, descrição e conteúdo são obrigatórios' });

  await pool.query(
    `UPDATE posts SET title=$1, description=$2, content=$3, "thumbImage"=$4 WHERE id=$5`,
    [title, description, content, thumbImage || '', post.id]
  );
  res.json({ ok: true });
}));

app.delete('/postagens/:id', auth, wrap(async (req, res) => {
  const result = await pool.query('SELECT * FROM posts WHERE id = $1', [req.params.id]);
  const post = result.rows[0];
  if (!post) return res.status(404).json({ erro: 'Postagem não encontrada' });
  if (post.user_id !== req.user.id) return res.status(403).json({ erro: 'Sem permissão' });

  await pool.query('DELETE FROM posts WHERE id = $1', [post.id]);
  res.json({ ok: true });
}));

// ---------- COMENTÁRIOS ----------
app.get('/postagens/:id/comentarios', wrap(async (req, res) => {
  const result = await pool.query(
    `SELECT c.*, u.name AS author FROM comments c
     JOIN users u ON u.id = c.user_id
     WHERE c.post_id = $1 ORDER BY c.id DESC`,
    [req.params.id]
  );
  res.json(result.rows);
}));

app.post('/postagens/:id/comentarios', auth, wrap(async (req, res) => {
  const text = (req.body.text || '').trim();
  if (!text) return res.status(400).json({ erro: 'Comentário vazio' });

  const post = await pool.query('SELECT id FROM posts WHERE id = $1', [req.params.id]);
  if (!post.rows.length) return res.status(404).json({ erro: 'Postagem não encontrada' });

  const info = await pool.query(
    'INSERT INTO comments (post_id, user_id, text) VALUES ($1,$2,$3) RETURNING id',
    [req.params.id, req.user.id, text]
  );
  res.status(201).json({ id: info.rows[0].id });
}));

app.delete('/comentarios/:id', auth, wrap(async (req, res) => {
  const result = await pool.query(
    `SELECT c.*, p.user_id AS post_owner FROM comments c
     JOIN posts p ON p.id = c.post_id WHERE c.id = $1`,
    [req.params.id]
  );
  const c = result.rows[0];
  if (!c) return res.status(404).json({ erro: 'Comentário não encontrado' });
  if (c.user_id !== req.user.id && c.post_owner !== req.user.id)
    return res.status(403).json({ erro: 'Sem permissão' });

  await pool.query('DELETE FROM comments WHERE id = $1', [c.id]);
  res.json({ ok: true });
}));

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ erro: 'Erro interno do servidor' });
});

const PORT = process.env.PORT || 3000;
init()
  .then(() => app.listen(PORT, () => console.log('API rodando na porta ' + PORT)))
  .catch((err) => {
    console.error('Não consegui conectar ao banco:', err);
    process.exit(1);
  });

  
