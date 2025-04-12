require('dotenv').config();
const express = require('express');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const path = require('path');
const { User } = require('./models/User');
const { Work } = require('./models/Work');

const app = express();
const PORT = process.env.PORT || 3000;

// MongoDB接続
mongoose.connect(process.env.MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
})
.then(() => console.log('MongoDB Connected'))
.catch(err => console.error('MongoDB connection error:', err));

// ミドルウェアの設定
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// セッション設定
app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  store: MongoStore.create({ 
    mongoUrl: process.env.MONGODB_URI,
    ttl: 14 * 24 * 60 * 60 // 14日間
  }),
  cookie: { 
    secure: process.env.NODE_ENV === 'production',
    maxAge: 14 * 24 * 60 * 60 * 1000 // 14日間
  }
}));

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

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
  try {
    const user = await User.findOne({ username });
    
    if (user && await bcrypt.compare(password, user.password)) {
      req.session.userId = user._id;
      req.session.username = user.username;
      res.redirect('/dashboard');
    } else {
      res.render('login', { error: 'ユーザー名またはパスワードが間違っています' });
    }
  } catch (err) {
    console.error('Login error:', err);
    res.render('login', { error: 'ログイン処理中にエラーが発生しました' });
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

  try {
    const existingUser = await User.findOne({ username });
    
    if (existingUser) {
      return res.render('register', { error: 'このユーザー名は既に使用されています' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = new User({
      username,
      password: hashedPassword,
      friends: []
    });

    await newUser.save();

    req.session.userId = newUser._id;
    req.session.username = newUser.username;
    res.redirect('/dashboard');
  } catch (err) {
    console.error('Registration error:', err);
    res.render('register', { error: '登録処理中にエラーが発生しました' });
  }
});

// ダッシュボード
app.get('/dashboard', requireLogin, async (req, res) => {
  try {
    const currentUser = await User.findById(req.session.userId);
    if (!currentUser) {
      req.session.destroy();
      return res.redirect('/login');
    }

    // 自分の作品を取得
    const myWorks = await Work.find({ authorId: currentUser._id });
    
    // 自分の作品と友達の作品を取得
    const friendWorks = await Work.find({
      $or: [
        { isPublic: true },
        { 
          authorId: { $in: currentUser.friends }, 
          isFriendsOnly: true 
        }
      ],
      authorId: { $ne: currentUser._id } // 自分の作品は除外
    });

    // 他のユーザーを取得（自分を除く）
    const allUsers = await User.find({ 
      _id: { $ne: currentUser._id } 
    }).select('_id username');

    res.render('dashboard', { 
      user: currentUser,
      myWorks,
      friendWorks,
      allUsers
    });
  } catch (err) {
    console.error('Dashboard error:', err);
    res.status(500).send('サーバーエラーが発生しました');
  }
});

// 友達追加
app.post('/add-friend', requireLogin, async (req, res) => {
  const { friendId } = req.body;
  
  try {
    const currentUser = await User.findById(req.session.userId);
    
    if (!currentUser.friends.includes(friendId)) {
      currentUser.friends.push(friendId);
      await currentUser.save();
    }
    
    res.redirect('/dashboard');
  } catch (err) {
    console.error('Add friend error:', err);
    res.status(500).send('サーバーエラーが発生しました');
  }
});

// 新規作品投稿ページ
app.get('/works/new', requireLogin, (req, res) => {
  res.render('new-work', { 
    user: { 
      id: req.session.userId, 
      username: req.session.username 
    } 
  });
});

// 作品投稿処理
app.post('/works', requireLogin, async (req, res) => {
  const { title, content, visibility } = req.body;
  
  try {
    const newWork = new Work({
      title,
      content,
      authorId: req.session.userId,
      authorName: req.session.username,
      isPublic: visibility === 'public',
      isFriendsOnly: visibility === 'friends'
    });
    
    await newWork.save();
    res.redirect('/dashboard');
  } catch (err) {
    console.error('Create work error:', err);
    res.status(500).send('作品の投稿中にエラーが発生しました');
  }
});

// 作品詳細ページ
app.get('/works/:id', requireLogin, async (req, res) => {
  try {
    const work = await Work.findById(req.params.id);
    
    if (!work) {
      return res.status(404).send('作品が見つかりません');
    }
    
    const currentUser = await User.findById(req.session.userId);
    
    // アクセス権チェック
    const canAccess = 
      work.isPublic || 
      work.authorId.toString() === currentUser._id.toString() || 
      (work.isFriendsOnly && currentUser.friends.includes(work.authorId.toString()));
    
    if (!canAccess) {
      return res.status(403).send('この作品にアクセスする権限がありません');
    }
    
    res.render('work-detail', { work, user: currentUser });
  } catch (err) {
    console.error('View work error:', err);
    res.status(500).send('サーバーエラーが発生しました');
  }
});

// ログアウト
app.get('/logout', (req, res) => {
  req.session.destroy(err => {
    if (err) {
      console.error('Logout error:', err);
      return res.status(500).send('ログアウト中にエラーが発生しました');
    }
    res.redirect('/');
  });
});

// エラーハンドリング
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).render('error', { 
    message: 'サーバーエラーが発生しました',
    error: process.env.NODE_ENV === 'development' ? err : {}
  });
});

// 404ハンドリング
app.use((req, res) => {
  res.status(404).render('error', { 
    message: 'ページが見つかりません',
    error: {}
  });
});

// Vercelではリスニングしない（開発環境のみ）
if (process.env.NODE_ENV !== 'production') {
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
}

module.exports = app;

