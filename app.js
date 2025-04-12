// app.js - Express.jsを使用したメインアプリケーションファイル

const express = require('express');
const session = require('express-session');
const bcrypt = require('bcrypt');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// データストア (実際のアプリケーションではデータベースを使用)
const USERS_FILE = path.join(__dirname, 'data', 'users.json');
const WORKS_FILE = path.join(__dirname, 'data', 'works.json');

// ディレクトリが存在しない場合は作成
if (!fs.existsSync(path.join(__dirname, 'data'))) {
  fs.mkdirSync(path.join(__dirname, 'data'));
}

// ファイルが存在しない場合は初期化
if (!fs.existsSync(USERS_FILE)) {
  fs.writeFileSync(USERS_FILE, JSON.stringify([]));
}
if (!fs.existsSync(WORKS_FILE)) {
  fs.writeFileSync(WORKS_FILE, JSON.stringify([]));
}

// ミドルウェアの設定
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
  secret: 'your-secret-key',
  resave: false,
  saveUninitialized: true,
  cookie: { secure: false } // 本番環境ではtrueに設定
}));

app.set('view engine', 'ejs');

// ユーティリティ関数
function readDataFile(filePath) {
  const data = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(data);
}

function writeDataFile(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

// ログイン状態確認ミドルウェア
function requireLogin(req, res, next) {
  if (req.session.userId) {
    next();
  } else {
    res.redirect('/login');
  }
}

// ルート定義
app.get('/', (req, res) => {
  if (req.session.userId) {
    res.redirect('/dashboard');
  } else {
    res.render('index', { user: null });
  }
});

// ログインページ
app.get('/login', (req, res) => {
  res.render('login', { error: null });
});

// ログイン処理
app.post('/login', async (req, res) => {
  const { username, password } = req.body;
  const users = readDataFile(USERS_FILE);
  const user = users.find(u => u.username === username);

  if (user && await bcrypt.compare(password, user.password)) {
    req.session.userId = user.id;
    req.session.username = user.username;
    res.redirect('/dashboard');
  } else {
    res.render('login', { error: 'ユーザー名またはパスワードが間違っています' });
  }
});

// 新規登録ページ
app.get('/register', (req, res) => {
  res.render('register', { error: null });
});

// 新規登録処理
app.post('/register', async (req, res) => {
  const { username, password, confirmPassword } = req.body;
  
  if (password !== confirmPassword) {
    return res.render('register', { error: 'パスワードが一致しません' });
  }

  const users = readDataFile(USERS_FILE);
  
  if (users.some(u => u.username === username)) {
    return res.render('register', { error: 'このユーザー名は既に使用されています' });
  }

  const hashedPassword = await bcrypt.hash(password, 10);
  const newUser = {
    id: Date.now().toString(),
    username,
    password: hashedPassword,
    friends: []
  };

  users.push(newUser);
  writeDataFile(USERS_FILE, users);

  req.session.userId = newUser.id;
  req.session.username = newUser.username;
  res.redirect('/dashboard');
});

// ダッシュボード
app.get('/dashboard', requireLogin, (req, res) => {
  const users = readDataFile(USERS_FILE);
  const works = readDataFile(WORKS_FILE);
  const currentUser = users.find(u => u.id === req.session.userId);
  
  // 自分の作品と友達の作品を取得
  const myWorks = works.filter(w => w.authorId === currentUser.id);
  const friendWorks = works.filter(w => 
    w.isPublic || 
    (currentUser.friends.includes(w.authorId) && w.isFriendsOnly)
  );

  res.render('dashboard', { 
    user: currentUser,
    myWorks,
    friendWorks,
    allUsers: users.filter(u => u.id !== currentUser.id)
  });
});

// 友達追加
app.post('/add-friend', requireLogin, (req, res) => {
  const { friendId } = req.body;
  const users = readDataFile(USERS_FILE);
  const currentUser = users.find(u => u.id === req.session.userId);
  
  if (!currentUser.friends.includes(friendId)) {
    currentUser.friends.push(friendId);
    writeDataFile(USERS_FILE, users);
  }
  
  res.redirect('/dashboard');
});

// 新規作品投稿ページ
app.get('/works/new', requireLogin, (req, res) => {
  res.render('new-work', { user: { id: req.session.userId, username: req.session.username } });
});

// 作品投稿処理
app.post('/works', requireLogin, (req, res) => {
  const { title, content, visibility } = req.body;
  const works = readDataFile(WORKS_FILE);
  
  const newWork = {
    id: Date.now().toString(),
    title,
    content,
    authorId: req.session.userId,
    authorName: req.session.username,
    createdAt: new Date().toISOString(),
    isPublic: visibility === 'public',
    isFriendsOnly: visibility === 'friends'
  };
  
  works.push(newWork);
  writeDataFile(WORKS_FILE, works);
  
  res.redirect('/dashboard');
});

// 作品詳細ページ
app.get('/works/:id', requireLogin, (req, res) => {
  const works = readDataFile(WORKS_FILE);
  const users = readDataFile(USERS_FILE);
  const work = works.find(w => w.id === req.params.id);
  const currentUser = users.find(u => u.id === req.session.userId);
  
  if (!work) {
    return res.status(404).send('作品が見つかりません');
  }
  
  // アクセス権チェック
  const canAccess = 
    work.isPublic || 
    work.authorId === currentUser.id || 
    (work.isFriendsOnly && currentUser.friends.includes(work.authorId));
  
  if (!canAccess) {
    return res.status(403).send('この作品にアクセスする権限がありません');
  }
  
  res.render('work-detail', { work, user: currentUser });
});

// ログアウト
app.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/');
});

// サーバー起動
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
