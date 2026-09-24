const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { pool, init } = require('./db');

const SECRET = process.env.JWT_SECRET || 'troque-esta-chave-em-producao';
const app = express();
app.use(cors());
app.use(express.json());

// Captura erros de funções async e manda pro handler de erro
const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);

// ---------- Middleware de autenticação ----------
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

// ---------- CADASTRO ----------
app.post('/auth/register', wrap(async (req, res) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password || password.length < 6)
    return res.status(400).json({ erro: 'Preencha tudo (senha mínima: 6 caracteres)' });

  const [existe] = await pool.execute('SELECT id FROM users WHERE email = ?', [email]);
  if (existe.length) return res.status(409).json({ erro: 'E-mail já cadastrado' });

  const hash = bcrypt.hashSync(password, 10);
  const [info] = await pool.execute(
    'INSERT INTO users (name, email, password) VALUES (?, ?, ?)',
    [name, email, hash]
  );

  const user = { id: info.insertId, name };
  res.status(201).json({ token: gerarToken(user), user });
}));

// ---------- LOGIN ----------
app.post('/auth/login', wrap(async (req, res) => {
  const { email, password } = req.body;
  const [rows] = await pool.execute('SELECT * FROM users WHERE email = ?', [email || '']);
  const u = rows[0];
  if (!u || !bcrypt.compareSync(password || '', u.password))
    return res.status(401).json({ erro: 'E-mail ou senha inválidos' });

  const user = { id: u.id, name: u.name };
  res.json({ token: gerarToken(user), user });
}));

// ---------- POSTS ----------
app.get('/postagens', wrap(async (req, res) => {
  const [rows] = await pool.execute(
    `SELECT p.*, u.name AS author FROM posts p
     JOIN users u ON u.id = p.user_id ORDER BY p.id DESC`
  );
  res.json(rows);
}));

app.get('/postagens/:id', wrap(async (req, res) => {
  const [rows] = await pool.execute(
    `SELECT p.*, u.name AS author FROM posts p
     JOIN users u ON u.id = p.user_id WHERE p.id = ?`,
    [req.params.id]
  );
  if (!rows.length) return res.status(404).json({ erro: 'Postagem não encontrada' });
  res.json(rows[0]);
}));

app.post('/postagens', auth, wrap(async (req, res) => {
  const { title, description, content, thumbImage } = req.body;
  if (!title || !description || !content)
    return res.status(400).json({ erro: 'Título, descrição e conteúdo são obrigatórios' });

  const [info] = await pool.execute(
    'INSERT INTO posts (user_id, title, description, content, thumbImage) VALUES (?,?,?,?,?)',
    [req.user.id, title, description, content, thumbImage || '']
  );
  res.status(201).json({ id: info.insertId });
}));

app.put('/postagens/:id', auth, wrap(async (req, res) => {
  const [rows] = await pool.execute('SELECT * FROM posts WHERE id = ?', [req.params.id]);
  const post = rows[0];
  if (!post) return res.status(404).json({ erro: 'Postagem não encontrada' });
  if (post.user_id !== req.user.id) return res.status(403).json({ erro: 'Sem permissão' });

  const { title, description, content, thumbImage } = req.body;
  if (!title || !description || !content)
    return res.status(400).json({ erro: 'Título, descrição e conteúdo são obrigatórios' });

  await pool.execute(
    'UPDATE posts SET title=?, description=?, content=?, thumbImage=? WHERE id=?',
    [title, description, content, thumbImage || '', post.id]
  );
  res.json({ ok: true });
}));

app.delete('/postagens/:id', auth, wrap(async (req, res) => {
  const [rows] = await pool.execute('SELECT * FROM posts WHERE id = ?', [req.params.id]);
  const post = rows[0];
  if (!post) return res.status(404).json({ erro: 'Postagem não encontrada' });
  if (post.user_id !== req.user.id) return res.status(403).json({ erro: 'Sem permissão' });

  await pool.execute('DELETE FROM posts WHERE id = ?', [post.id]); // comentários caem em cascata
  res.json({ ok: true });
}));

// ---------- COMENTÁRIOS ----------
app.get('/postagens/:id/comentarios', wrap(async (req, res) => {
  const [rows] = await pool.execute(
    `SELECT c.*, u.name AS author FROM comments c
     JOIN users u ON u.id = c.user_id
     WHERE c.post_id = ? ORDER BY c.id DESC`,
    [req.params.id]
  );
  res.json(rows);
}));

app.post('/postagens/:id/comentarios', auth, wrap(async (req, res) => {
  const text = (req.body.text || '').trim();
  if (!text) return res.status(400).json({ erro: 'Comentário vazio' });

  const [post] = await pool.execute('SELECT id FROM posts WHERE id = ?', [req.params.id]);
  if (!post.length) return res.status(404).json({ erro: 'Postagem não encontrada' });

  const [info] = await pool.execute(
    'INSERT INTO comments (post_id, user_id, text) VALUES (?,?,?)',
    [req.params.id, req.user.id, text]
  );
  res.status(201).json({ id: info.insertId });
}));

// Pode apagar: o autor do comentário OU o dono da postagem
app.delete('/comentarios/:id', auth, wrap(async (req, res) => {
  const [rows] = await pool.execute(
    `SELECT c.*, p.user_id AS post_owner FROM comments c
     JOIN posts p ON p.id = c.post_id WHERE c.id = ?`,
    [req.params.id]
  );
  const c = rows[0];
  if (!c) return res.status(404).json({ erro: 'Comentário não encontrado' });
  if (c.user_id !== req.user.id && c.post_owner !== req.user.id)
    return res.status(403).json({ erro: 'Sem permissão' });

  await pool.execute('DELETE FROM comments WHERE id = ?', [c.id]);
  res.json({ ok: true });
}));

// ---------- Handler de erros ----------
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ erro: 'Erro interno do servidor' });
});

// ---------- Início ----------
init()
  .then(() => app.listen(3000, () => console.log('API rodando em http://localhost:3000')))
  .catch((err) => {
    console.error('Não consegui conectar ao MySQL:', err.message);
    process.exit(1);
  });