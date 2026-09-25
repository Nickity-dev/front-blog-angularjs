var API = 'https://front-blog-angularjs-lah1.onrender.com';

angular.module('blog', ['ngRoute'])

.config(function ($routeProvider, $httpProvider) {
  $routeProvider
    .when('/',            { templateUrl: 'views/lista.html',    controller: 'ListaCtrl' })
    .when('/post/:id',    { templateUrl: 'views/post.html',     controller: 'PostCtrl' })
    .when('/novo',        { templateUrl: 'views/form.html',     controller: 'FormCtrl' })
    .when('/editar/:id',  { templateUrl: 'views/form.html',     controller: 'FormCtrl' })
    .when('/login',       { templateUrl: 'views/login.html',    controller: 'AuthCtrl' })
    .when('/cadastro',    { templateUrl: 'views/cadastro.html', controller: 'AuthCtrl' })
    .otherwise({ redirectTo: '/' });

  $httpProvider.interceptors.push('AuthInterceptor');
})

// Anexa o token JWT em toda requisição
.factory('AuthInterceptor', function () {
  return {
    request: function (config) {
      var token = localStorage.getItem('token');
      if (token) config.headers.Authorization = 'Bearer ' + token;
      return config;
    }
  };
})

.factory('Auth', function ($http, $location) {
  function salvar(res) {
    localStorage.setItem('token', res.data.token);
    localStorage.setItem('user', JSON.stringify(res.data.user));
  }
  return {
    user: function () { return JSON.parse(localStorage.getItem('user') || 'null'); },
    login: function (d)    { return $http.post(API + '/auth/login', d).then(salvar); },
    cadastrar: function (d){ return $http.post(API + '/auth/register', d).then(salvar); },
    sair: function () {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      $location.path('/');
    }
  };
})

.controller('NavCtrl', function ($scope, Auth) {
  $scope.Auth = Auth;
  $scope.sair = Auth.sair;
})

// ---------- Ajuda visual: iniciais e cor por autor ----------
.factory('Ui', function () {
  var cores = ['#E8A33D', '#1D7874', '#B23A48', '#3B6E8F'];
  return {
    iniciais: function (nome) {
      return nome ? nome.trim().charAt(0).toUpperCase() : '?';
    },
    corAutor: function (nome) {
      if (!nome) return cores[0];
      var soma = 0;
      for (var i = 0; i < nome.length; i++) soma += nome.charCodeAt(i);
      return cores[soma % cores.length];
    }
  };
})

// ---------- Lista + destaque + expandir notícia ----------
.controller('ListaCtrl', function ($scope, $http, Ui) {
  $scope.Ui = Ui;
  $http.get(API + '/postagens').then(function (res) {
    $scope.destaque = res.data[0] || null;
    $scope.resto = res.data.slice(1);
  });
  $scope.alternar = function (p) { p.aberto = !p.aberto; };
})

// ---------- Notícia individual + comentários ----------
.controller('PostCtrl', function ($scope, $http, $routeParams, $location, Auth, Ui) {
  var id = $routeParams.id;
  $scope.Auth = Auth;
  $scope.Ui = Ui;
  $scope.novo = { text: '' };

  function carregarComentarios() {
    $http.get(API + '/postagens/' + id + '/comentarios').then(function (res) {
      $scope.comentarios = res.data;
    });
  }

  $http.get(API + '/postagens/' + id).then(function (res) { $scope.post = res.data; });
  carregarComentarios();

  $scope.ehDono = function () {
    return Auth.user() && $scope.post && Auth.user().id === $scope.post.user_id;
  };
  $scope.podeApagar = function (c) {
    return Auth.user() && (Auth.user().id === c.user_id || $scope.ehDono());
  };

  $scope.comentar = function () {
    $http.post(API + '/postagens/' + id + '/comentarios', $scope.novo).then(function () {
      $scope.novo.text = '';
      carregarComentarios();
    }, function (err) { alert(err.data.erro); });
  };

  $scope.apagarComentario = function (c) {
    if (!confirm('Apagar este comentário?')) return;
    $http.delete(API + '/comentarios/' + c.id).then(carregarComentarios,
      function (err) { alert(err.data.erro); });
  };

  $scope.apagarPost = function () {
    if (!confirm('Excluir esta postagem?')) return;
    $http.delete(API + '/postagens/' + id).then(function () { $location.path('/'); });
  };
})

// ---------- Criar / editar postagem ----------
.controller('FormCtrl', function ($scope, $http, $routeParams, $location, Auth) {
  if (!Auth.user()) { $location.path('/login'); return; }

  var id = $routeParams.id;
  $scope.editando = !!id;
  $scope.post = {};

  if (id) {
    $http.get(API + '/postagens/' + id).then(function (res) { $scope.post = res.data; });
  }

  $scope.salvar = function () {
    var req = id
      ? $http.put(API + '/postagens/' + id, $scope.post)
      : $http.post(API + '/postagens', $scope.post);

    req.then(function (res) {
      $location.path('/post/' + (id || res.data.id));
    }, function (err) { $scope.erro = err.data.erro; });
  };
})

// ---------- Login e cadastro ----------
.controller('AuthCtrl', function ($scope, $location, Auth) {
  $scope.dados = {};
  function ok() { $location.path('/'); }
  function falha(err) { $scope.erro = err.data && err.data.erro; }

  $scope.entrar = function () { Auth.login($scope.dados).then(ok, falha); };
  $scope.cadastrar = function () { Auth.cadastrar($scope.dados).then(ok, falha); };
});
