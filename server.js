require('dotenv').config();
const nodemailer = require('nodemailer');
const express = require('express');
const mysql = require('mysql2');
const path = require('path');
const cors = require('cors');
const bcrypt = require('bcrypt');

const app = express();
const PORT = process.env.PORT || 3000;

const mailTransporter = nodemailer.createTransport({
  host: process.env.MAIL_HOST,
  port: Number(process.env.MAIL_PORT || 465),
  secure: true,
  auth: {
    user: process.env.MAIL_USER,
    pass: process.env.MAIL_PASS
  }
});


function enviarCorreo({ to, subject, html }) {
  return mailTransporter.sendMail({
    from: process.env.MAIL_FROM || process.env.MAIL_USER,
    to,
    subject,
    html
  });
}
/* =========================
   MIDDLEWARES
========================= */
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

/* =========================
   ARCHIVOS ESTÁTICOS
========================= */
app.use(express.static(__dirname));
app.use('/assets', express.static(path.join(__dirname, 'assets')));
app.use('/views', express.static(path.join(__dirname, 'views')));

/* =========================
   CONEXIÓN MYSQL
========================= */
const db = mysql.createConnection({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME
});

db.connect((err) => {
  if (err) {
    console.error('Error al conectar con MySQL:', err.message);
    return;
  }
  console.log('Conectado a MySQL correctamente');
});

/* =========================
   HELPERS
========================= */
function enviarError(res, err, mensaje = 'Error del servidor') {
  console.error(err);
  return res.status(500).json({
    ok: false,
    message: err?.message || mensaje
  });
}

/* =========================
   RUTA DE PRUEBA
========================= */
app.get('/api/test', (req, res) => {
  res.json({ ok: true, message: 'Servidor funcionando correctamente' });
});

/* =========================
   REGISTRO DE USUARIO
   - Si es cliente, también lo inserta en clientes
========================= */
app.post('/api/register', async (req, res) => {
  try {
    const { nombre, correo, telefono, empresa, password, rol, tipo_cuenta } = req.body;

    if (!nombre || !correo || !password || !rol || !tipo_cuenta) {
      return res.status(400).json({
        ok: false,
        message: 'Faltan datos obligatorios'
      });
    }

    const tiposValidos = ['interno', 'cliente'];
    if (!tiposValidos.includes(tipo_cuenta)) {
      return res.status(400).json({
        ok: false,
        message: 'Tipo de cuenta no válido'
      });
    }

    let rolesValidos = [];
    if (tipo_cuenta === 'interno') {
      rolesValidos = ['administrador', 'ventas', 'logistica', 'soporte'];
    } else {
      rolesValidos = ['cliente'];
    }

    if (!rolesValidos.includes(rol)) {
      return res.status(400).json({
        ok: false,
        message: 'Rol no válido para este tipo de cuenta'
      });
    }

    db.query('SELECT id FROM usuarios WHERE correo = ?', [correo], async (err, results) => {
      if (err) return enviarError(res, err);

      if (results.length > 0) {
        return res.status(409).json({
          ok: false,
          message: 'El correo ya está registrado'
        });
      }

      const passwordHash = await bcrypt.hash(password, 10);

      const sqlUsuario = `
        INSERT INTO usuarios (nombre, correo, password, tipo_cuenta, rol)
        VALUES (?, ?, ?, ?, ?)
      `;

      db.query(sqlUsuario, [nombre, correo, passwordHash, tipo_cuenta, rol], (err2, result) => {
        if (err2) return enviarError(res, err2);

        if (tipo_cuenta === 'cliente') {
          const sqlCliente = `
            INSERT INTO clientes (nombre, correo, telefono, empresa, estado, etapa_crm)
            VALUES (?, ?, ?, ?, 'activo', 'Prospecto')
          `;

          db.query(sqlCliente, [nombre, correo, telefono || null, empresa || null], (err3) => {
            if (err3) return enviarError(res, err3);

            return res.json({
              ok: true,
              message: 'Cliente registrado correctamente',
              id: result.insertId
            });
          });
        } else {
          return res.json({
            ok: true,
            message: 'Usuario interno registrado correctamente',
            id: result.insertId
          });
        }
      });
    });
  } catch (error) {
    return enviarError(res, error);
  }
});

/* =========================
   LOGIN
========================= */
app.post('/api/login', (req, res) => {
  const { correo, password } = req.body;

  if (!correo || !password) {
    return res.status(400).json({
      ok: false,
      message: 'Faltan correo o contraseña'
    });
  }

  db.query('SELECT * FROM usuarios WHERE correo = ?', [correo], async (err, results) => {
    if (err) return enviarError(res, err);

    if (results.length === 0) {
      return res.status(401).json({
        ok: false,
        message: 'Usuario no encontrado'
      });
    }

    const usuario = results[0];
    const coincide = await bcrypt.compare(password, usuario.password);

    if (!coincide) {
      return res.status(401).json({
        ok: false,
        message: 'Contraseña incorrecta'
      });
    }

    if (usuario.tipo_cuenta === 'cliente') {
      db.query(
        'SELECT id, telefono, empresa FROM clientes WHERE correo = ? LIMIT 1',
        [usuario.correo],
        (errCliente, clienteRes) => {
          if (errCliente) return enviarError(res, errCliente);

          const cliente = clienteRes.length ? clienteRes[0] : null;

          return res.json({
            ok: true,
            message: 'Login correcto',
            usuario: {
              id: usuario.id,
              cliente_id: cliente ? cliente.id : null,
              nombre: usuario.nombre,
              correo: usuario.correo,
              tipo_cuenta: usuario.tipo_cuenta,
              rol: usuario.rol,
              telefono: cliente ? cliente.telefono : null,
              empresa: cliente ? cliente.empresa : null
            }
          });
        }
      );
    } else {
      return res.json({
        ok: true,
        message: 'Login correcto',
        usuario: {
          id: usuario.id,
          cliente_id: null,
          nombre: usuario.nombre,
          correo: usuario.correo,
          tipo_cuenta: usuario.tipo_cuenta,
          rol: usuario.rol
        }
      });
    }
  });
});

/* =========================
   CRUD CLIENTES
========================= */

/* Crear cliente */
app.post('/api/clientes', (req, res) => {
  const { nombre, correo, telefono, empresa, estado, etapa_crm } = req.body;

  if (!nombre || !correo) {
    return res.status(400).json({
      ok: false,
      message: 'Nombre y correo son obligatorios'
    });
  }

  const sql = `
    INSERT INTO clientes (nombre, correo, telefono, empresa, estado, etapa_crm)
    VALUES (?, ?, ?, ?, ?, ?)
  `;

  db.query(
    sql,
    [
      nombre,
      correo,
      telefono || null,
      empresa || null,
      estado || 'activo',
      etapa_crm || 'Prospecto'
    ],
    (err, result) => {
      if (err) return enviarError(res, err);

      return res.json({
        ok: true,
        message: 'Cliente creado correctamente',
        id: result.insertId
      });
    }
  );
});

/* Obtener todos los clientes */
app.get('/api/clientes', (req, res) => {
  const sql = 'SELECT * FROM clientes ORDER BY id DESC';

  db.query(sql, (err, results) => {
    if (err) return enviarError(res, err);
    return res.json(results);
  });
});

/* Obtener cliente por ID */
app.get('/api/clientes/:id', (req, res) => {
  const { id } = req.params;

  db.query('SELECT * FROM clientes WHERE id = ?', [id], (err, results) => {
    if (err) return enviarError(res, err);

    if (results.length === 0) {
      return res.status(404).json({
        ok: false,
        message: 'Cliente no encontrado'
      });
    }

    return res.json(results[0]);
  });
});

/* Editar cliente */
app.put('/api/clientes/:id', (req, res) => {
  const { id } = req.params;
  const { nombre, correo, telefono, empresa, estado, etapa_crm } = req.body;

  const sql = `
    UPDATE clientes
    SET nombre = ?, correo = ?, telefono = ?, empresa = ?, estado = ?, etapa_crm = ?
    WHERE id = ?
  `;

  db.query(
    sql,
    [nombre, correo, telefono || null, empresa || null, estado, etapa_crm, id],
    (err) => {
      if (err) return enviarError(res, err);

      return res.json({
        ok: true,
        message: 'Cliente actualizado correctamente'
      });
    }
  );
});

/* Eliminar cliente */
app.delete('/api/clientes/:id', (req, res) => {
  const { id } = req.params;

  db.query('DELETE FROM clientes WHERE id = ?', [id], (err) => {
    if (err) return enviarError(res, err);

    return res.json({
      ok: true,
      message: 'Cliente eliminado correctamente'
    });
  });
});

/* =========================
   ETAPA CRM
========================= */
app.put('/api/clientes/:id/etapa', (req, res) => {
  const { id } = req.params;
  const { etapa_crm } = req.body;

  const etapasValidas = ['Prospecto', 'Activo', 'Frecuente', 'Inactivo'];

  if (!etapasValidas.includes(etapa_crm)) {
    return res.status(400).json({
      ok: false,
      message: 'Etapa CRM no válida'
    });
  }

  db.query(
    'UPDATE clientes SET etapa_crm = ? WHERE id = ?',
    [etapa_crm, id],
    (err) => {
      if (err) return enviarError(res, err);

      return res.json({
        ok: true,
        message: 'Etapa CRM actualizada correctamente'
      });
    }
  );
});

/* =========================
   INTERACCIONES
========================= */

/* Registrar interacción */
app.post('/api/interacciones', (req, res) => {
  const { cliente_id, tipo, descripcion, usuario_id } = req.body;

  if (!cliente_id || !tipo || !descripcion || !usuario_id) {
    return res.status(400).json({
      ok: false,
      message: 'Faltan datos obligatorios'
    });
  }

  const tiposValidos = ['llamada', 'correo', 'reunion'];
  if (!tiposValidos.includes(tipo)) {
    return res.status(400).json({
      ok: false,
      message: 'Tipo de interacción no válido'
    });
  }

  const sql = `
    INSERT INTO interacciones (cliente_id, tipo, descripcion, usuario_id)
    VALUES (?, ?, ?, ?)
  `;

  db.query(sql, [cliente_id, tipo, descripcion, usuario_id], (err, result) => {
    if (err) return enviarError(res, err);

    return res.json({
      ok: true,
      message: 'Interacción registrada correctamente',
      id: result.insertId
    });
  });
});

/* Obtener interacciones de un cliente */
app.get('/api/clientes/:id/interacciones', (req, res) => {
  const { id } = req.params;

  const sql = `
    SELECT i.*, u.nombre AS usuario_nombre
    FROM interacciones i
    INNER JOIN usuarios u ON i.usuario_id = u.id
    WHERE i.cliente_id = ?
    ORDER BY i.fecha DESC
  `;

  db.query(sql, [id], (err, results) => {
    if (err) return enviarError(res, err);
    return res.json(results);
  });
});

/* =========================
   MÉTRICAS CRM
========================= */
app.get('/api/metricas/crm', (req, res) => {
  const metricas = {};

  db.query('SELECT COUNT(*) AS total FROM clientes', (err, totalRes) => {
    if (err) return enviarError(res, err);
    metricas.total_clientes = totalRes[0].total;

    db.query("SELECT COUNT(*) AS total FROM clientes WHERE estado = 'activo'", (err2, activosRes) => {
      if (err2) return enviarError(res, err2);
      metricas.clientes_activos = activosRes[0].total;

      db.query("SELECT COUNT(*) AS total FROM clientes WHERE estado = 'inactivo'", (err3, inactivosRes) => {
        if (err3) return enviarError(res, err3);
        metricas.clientes_inactivos = inactivosRes[0].total;

        const sqlInteracciones = `
          SELECT c.id, c.nombre, COUNT(i.id) AS total_interacciones
          FROM clientes c
          LEFT JOIN interacciones i ON c.id = i.cliente_id
          GROUP BY c.id, c.nombre
          ORDER BY total_interacciones DESC
        `;

        db.query(sqlInteracciones, (err4, interaccionesRes) => {
          if (err4) return enviarError(res, err4);
          metricas.interacciones_por_cliente = interaccionesRes;

          const sqlRiesgo = `
            SELECT c.*
            FROM clientes c
            LEFT JOIN interacciones i ON c.id = i.cliente_id
            GROUP BY c.id
            HAVING MAX(i.fecha) IS NULL OR MAX(i.fecha) < DATE_SUB(NOW(), INTERVAL 30 DAY)
          `;

          db.query(sqlRiesgo, (err5, riesgoRes) => {
            if (err5) return enviarError(res, err5);
            metricas.clientes_sin_interaccion_reciente = riesgoRes;

            return res.json(metricas);
          });
        });
      });
    });
  });
});

/* =========================
   MI ACTIVIDAD
========================= */
app.get('/api/usuarios/:id/actividad', (req, res) => {
  const { id } = req.params;

  const sql = `
    SELECT i.*, c.nombre AS cliente_nombre
    FROM interacciones i
    INNER JOIN clientes c ON i.cliente_id = c.id
    WHERE i.usuario_id = ?
    ORDER BY i.fecha DESC
  `;

  db.query(sql, [id], (err, results) => {
    if (err) return enviarError(res, err);
    return res.json(results);
  });
});

/* =========================
   USUARIOS INTERNOS
========================= */

/* Obtener usuarios internos */
app.get('/api/usuarios-internos', (req, res) => {
  const sql = `
    SELECT id, nombre, correo, tipo_cuenta, rol, creado_en
    FROM usuarios
    WHERE tipo_cuenta = 'interno'
    ORDER BY id DESC
  `;

  db.query(sql, (err, results) => {
    if (err) return enviarError(res, err);
    return res.json(results);
  });
});

/* Crear usuario interno */
app.post('/api/usuarios-internos', async (req, res) => {
  try {
    const { nombre, correo, password, rol } = req.body;

    if (!nombre || !correo || !password || !rol) {
      return res.status(400).json({
        ok: false,
        message: 'Faltan datos obligatorios'
      });
    }

    const rolesValidos = ['administrador', 'ventas', 'logistica', 'soporte'];
    if (!rolesValidos.includes(rol)) {
      return res.status(400).json({
        ok: false,
        message: 'Rol interno no válido'
      });
    }

    db.query('SELECT id FROM usuarios WHERE correo = ?', [correo], async (err, results) => {
      if (err) return enviarError(res, err);

      if (results.length > 0) {
        return res.status(409).json({
          ok: false,
          message: 'El correo ya está registrado'
        });
      }

      const passwordHash = await bcrypt.hash(password, 10);

      const sql = `
        INSERT INTO usuarios (nombre, correo, password, tipo_cuenta, rol)
        VALUES (?, ?, ?, 'interno', ?)
      `;

      db.query(sql, [nombre, correo, passwordHash, rol], (err2, result) => {
        if (err2) return enviarError(res, err2);

        return res.json({
          ok: true,
          message: 'Usuario interno creado correctamente',
          id: result.insertId
        });
      });
    });
  } catch (error) {
    return enviarError(res, error);
  }
});

/* =========================
   SCM - PROVEEDORES
========================= */

/* Crear proveedor */
app.post('/api/proveedores', (req, res) => {
  const { nombre, contacto, correo, telefono } = req.body;

  if (!nombre) {
    return res.status(400).json({
      ok: false,
      message: 'El nombre del proveedor es obligatorio'
    });
  }

  const sql = `
    INSERT INTO proveedores (nombre, contacto, correo, telefono)
    VALUES (?, ?, ?, ?)
  `;

  db.query(sql, [nombre, contacto || null, correo || null, telefono || null], (err, result) => {
    if (err) return enviarError(res, err);

    return res.json({
      ok: true,
      message: 'Proveedor creado correctamente',
      id: result.insertId
    });
  });
});

/* Obtener proveedores */
app.get('/api/proveedores', (req, res) => {
  const sql = 'SELECT * FROM proveedores ORDER BY id DESC';

  db.query(sql, (err, results) => {
    if (err) return enviarError(res, err);
    return res.json(results);
  });
});

/* =========================
   SCM - PRODUCTOS
========================= */

/* Crear producto */
app.post('/api/productos', (req, res) => {
  const {
    nombre,
    descripcion,
    categoria,
    stock_actual,
    stock_minimo,
    proveedor_id,
    costo_unitario,
    precio_venta,
    imagen_url,
    estado,
    destacado,
    estrategia_logistica
  } = req.body;

  if (!nombre) {
    return res.status(400).json({
      ok: false,
      message: 'El nombre del producto es obligatorio'
    });
  }

  const estrategiasValidas = ['PUSH', 'PULL'];
  const estrategia = estrategia_logistica || 'PULL';

  if (!estrategiasValidas.includes(estrategia)) {
    return res.status(400).json({
      ok: false,
      message: 'Estrategia logística no válida'
    });
  }

  const estadosValidos = ['activo', 'inactivo'];
  const estadoFinal = estado || 'activo';

  if (!estadosValidos.includes(estadoFinal)) {
    return res.status(400).json({
      ok: false,
      message: 'Estado del producto no válido'
    });
  }

  const sql = `
    INSERT INTO productos
    (
      nombre,
      descripcion,
      categoria,
      stock_actual,
      stock_minimo,
      proveedor_id,
      costo_unitario,
      precio_venta,
      imagen_url,
      estado,
      destacado,
      estrategia_logistica
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;

  db.query(
    sql,
    [
      nombre,
      descripcion || null,
      categoria || null,
      Number(stock_actual || 0),
      Number(stock_minimo || 0),
      proveedor_id || null,
      Number(costo_unitario || 0),
      Number(precio_venta || costo_unitario || 0),
      imagen_url || null,
      estadoFinal,
      Number(destacado || 0) ? 1 : 0,
      estrategia
    ],
    (err, result) => {
      if (err) return enviarError(res, err);

      return res.json({
        ok: true,
        message: 'Producto creado correctamente',
        id: result.insertId
      });
    }
  );
});

/* Obtener productos */
app.get('/api/productos', (req, res) => {
  const { estrategia } = req.query;

  let sql = `
    SELECT p.*, pr.nombre AS proveedor_nombre
    FROM productos p
    LEFT JOIN proveedores pr ON p.proveedor_id = pr.id
  `;
  const params = [];

  if (estrategia) {
    sql += ' WHERE p.estrategia_logistica = ?';
    params.push(estrategia);
  }

  sql += ' ORDER BY p.id DESC';

  db.query(sql, params, (err, results) => {
    if (err) return enviarError(res, err);
    return res.json(results);
  });
});

/* Editar producto */
app.put('/api/productos/:id', (req, res) => {
  const { id } = req.params;
  const {
    nombre,
    descripcion,
    categoria,
    stock_actual,
    stock_minimo,
    proveedor_id,
    costo_unitario,
    precio_venta,
    imagen_url,
    estado,
    destacado,
    estrategia_logistica
  } = req.body;

  const estadosValidos = ['activo', 'inactivo'];
  const estadoFinal = estado || 'activo';

  if (!estadosValidos.includes(estadoFinal)) {
    return res.status(400).json({
      ok: false,
      message: 'Estado del producto no válido'
    });
  }

  const sql = `
    UPDATE productos
    SET nombre = ?, descripcion = ?, categoria = ?, stock_actual = ?, stock_minimo = ?,
        proveedor_id = ?, costo_unitario = ?, precio_venta = ?, imagen_url = ?,
        estado = ?, destacado = ?, estrategia_logistica = ?
    WHERE id = ?
  `;

  db.query(
    sql,
    [
      nombre,
      descripcion || null,
      categoria || null,
      Number(stock_actual || 0),
      Number(stock_minimo || 0),
      proveedor_id || null,
      Number(costo_unitario || 0),
      Number(precio_venta || costo_unitario || 0),
      imagen_url || null,
      estadoFinal,
      Number(destacado || 0) ? 1 : 0,
      estrategia_logistica || 'PULL',
      id
    ],
    (err) => {
      if (err) return enviarError(res, err);

      return res.json({
        ok: true,
        message: 'Producto actualizado correctamente'
      });
    }
  );
});

/* Eliminar producto */
app.delete('/api/productos/:id', (req, res) => {
  const { id } = req.params;

  db.query('DELETE FROM productos WHERE id = ?', [id], (err) => {
    if (err) return enviarError(res, err);

    return res.json({
      ok: true,
      message: 'Producto eliminado correctamente'
    });
  });
});

/* Cambiar estrategia logística */
app.put('/api/productos/:id/estrategia', (req, res) => {
  const { id } = req.params;
  const { estrategia_logistica } = req.body;

  const estrategiasValidas = ['PUSH', 'PULL'];
  if (!estrategiasValidas.includes(estrategia_logistica)) {
    return res.status(400).json({
      ok: false,
      message: 'Estrategia logística no válida'
    });
  }

  db.query(
    'UPDATE productos SET estrategia_logistica = ? WHERE id = ?',
    [estrategia_logistica, id],
    (err) => {
      if (err) return enviarError(res, err);

      return res.json({
        ok: true,
        message: 'Estrategia logística actualizada correctamente'
      });
    }
  );
});

/* =========================
   SCM - INVENTARIO
========================= */

/* Registrar movimiento de inventario */
app.post('/api/inventario/movimiento', (req, res) => {
  const { producto_id, tipo, cantidad, motivo } = req.body;

  if (!producto_id || !tipo || !cantidad || !motivo) {
    return res.status(400).json({
      ok: false,
      message: 'Faltan datos obligatorios'
    });
  }

  const tiposValidos = ['entrada', 'salida'];
  if (!tiposValidos.includes(tipo)) {
    return res.status(400).json({
      ok: false,
      message: 'Tipo de movimiento no válido'
    });
  }

  db.query('SELECT * FROM productos WHERE id = ?', [producto_id], (err, results) => {
    if (err) return enviarError(res, err);

    if (results.length === 0) {
      return res.status(404).json({
        ok: false,
        message: 'Producto no encontrado'
      });
    }

    const producto = results[0];
    let nuevoStock = Number(producto.stock_actual);

    if (tipo === 'entrada') {
      nuevoStock += Number(cantidad);
    } else {
      nuevoStock -= Number(cantidad);
      if (nuevoStock < 0) {
        return res.status(400).json({
          ok: false,
          message: 'No hay suficiente stock para registrar la salida'
        });
      }
    }

    const sqlMovimiento = `
      INSERT INTO movimientos_inventario (producto_id, tipo, cantidad, motivo)
      VALUES (?, ?, ?, ?)
    `;

    db.query(sqlMovimiento, [producto_id, tipo, cantidad, motivo], (err2) => {
      if (err2) return enviarError(res, err2);

      db.query(
        'UPDATE productos SET stock_actual = ? WHERE id = ?',
        [nuevoStock, producto_id],
        (err3) => {
          if (err3) return enviarError(res, err3);

          /* Regla PUSH: si llega al mínimo o menos, generar pedido automático */
          if (
            producto.estrategia_logistica === 'PUSH' &&
            nuevoStock <= Number(producto.stock_minimo)
          ) {
            const cantidadReposicion = Math.max(Number(producto.stock_minimo) * 2, 10);

            db.query(
              `INSERT INTO pedidos (producto_id, cantidad, tipo, estado)
               VALUES (?, ?, 'reposicion', 'pendiente')`,
              [producto_id, cantidadReposicion],
              (err4) => {
                if (err4) return enviarError(res, err4);

                return res.json({
                  ok: true,
                  message: 'Movimiento registrado y pedido PUSH generado automáticamente',
                  stock_actual: nuevoStock
                });
              }
            );
          } else {
            return res.json({
              ok: true,
              message: 'Movimiento de inventario registrado correctamente',
              stock_actual: nuevoStock
            });
          }
        }
      );
    });
  });
});

/* Obtener movimientos por producto */
app.get('/api/productos/:id/movimientos', (req, res) => {
  const { id } = req.params;

  const sql = `
    SELECT *
    FROM movimientos_inventario
    WHERE producto_id = ?
    ORDER BY fecha DESC
  `;

  db.query(sql, [id], (err, results) => {
    if (err) return enviarError(res, err);
    return res.json(results);
  });
});

/* =========================
   SCM - PEDIDOS
========================= */

/* Crear pedido manual */
app.post('/api/pedidos', (req, res) => {
  const { producto_id, cantidad, tipo } = req.body;

  if (!producto_id || !cantidad || !tipo) {
    return res.status(400).json({
      ok: false,
      message: 'Faltan datos obligatorios'
    });
  }

  const tiposValidos = ['reposicion', 'venta'];
  if (!tiposValidos.includes(tipo)) {
    return res.status(400).json({
      ok: false,
      message: 'Tipo de pedido no válido'
    });
  }

  const sql = `
    INSERT INTO pedidos (producto_id, cantidad, tipo, estado)
    VALUES (?, ?, ?, 'pendiente')
  `;

  db.query(sql, [producto_id, cantidad, tipo], (err, result) => {
    if (err) return enviarError(res, err);

    return res.json({
      ok: true,
      message: 'Pedido creado correctamente',
      id: result.insertId
    });
  });
});

/* Obtener pedidos */
app.get('/api/pedidos', (req, res) => {
  const sql = `
    SELECT pe.*, p.nombre AS producto_nombre
    FROM pedidos pe
    INNER JOIN productos p ON pe.producto_id = p.id
    ORDER BY pe.id DESC
  `;

  db.query(sql, (err, results) => {
    if (err) return enviarError(res, err);
    return res.json(results);
  });
});

/* Cambiar estado del pedido */
app.put('/api/pedidos/:id/estado', (req, res) => {
  const { id } = req.params;
  const { estado } = req.body;

  const estadosValidos = ['pendiente', 'surtido'];
  if (!estadosValidos.includes(estado)) {
    return res.status(400).json({
      ok: false,
      message: 'Estado de pedido no válido'
    });
  }

  db.query(
    'UPDATE pedidos SET estado = ? WHERE id = ?',
    [estado, id],
    (err) => {
      if (err) return enviarError(res, err);

      return res.json({
        ok: true,
        message: 'Estado del pedido actualizado correctamente'
      });
    }
  );
});

/* =========================
   SCM - NIVEL DE MADUREZ
========================= */

/* Obtener estado SCM */
app.get('/api/scm/estado', (req, res) => {
  db.query('SELECT * FROM config_scm ORDER BY id ASC LIMIT 1', (err, results) => {
    if (err) return enviarError(res, err);

    if (results.length === 0) {
      return res.status(404).json({
        ok: false,
        message: 'No se encontró configuración SCM'
      });
    }

    return res.json(results[0]);
  });
});

/* Actualizar nivel SCM */
app.put('/api/scm/nivel', (req, res) => {
  const { nivel_scm } = req.body;

  const nivelesValidos = ['Inicial', 'En desarrollo', 'Optimizado'];
  if (!nivelesValidos.includes(nivel_scm)) {
    return res.status(400).json({
      ok: false,
      message: 'Nivel SCM no válido'
    });
  }

  db.query(
    'UPDATE config_scm SET nivel_scm = ? WHERE id = 1',
    [nivel_scm],
    (err) => {
      if (err) return enviarError(res, err);

      return res.json({
        ok: true,
        message: 'Nivel SCM actualizado correctamente'
      });
    }
  );
});

/* =========================
   SCM - REPORTES
========================= */

/* Inventario crítico */
app.get('/api/scm/reportes/inventario-critico', (req, res) => {
  const sql = `
    SELECT *
    FROM productos
    WHERE stock_actual <= stock_minimo
    ORDER BY stock_actual ASC
  `;

  db.query(sql, (err, results) => {
    if (err) return enviarError(res, err);
    return res.json(results);
  });
});

/* Productos con rotación lenta */
app.get('/api/scm/reportes/rotacion-lenta', (req, res) => {
  const sql = `
    SELECT p.id, p.nombre, COUNT(m.id) AS total_salidas
    FROM productos p
    LEFT JOIN movimientos_inventario m
      ON p.id = m.producto_id AND m.tipo = 'salida'
    GROUP BY p.id, p.nombre
    ORDER BY total_salidas ASC
  `;

  db.query(sql, (err, results) => {
    if (err) return enviarError(res, err);
    return res.json(results);
  });
});

/* Productos más vendidos */
app.get('/api/scm/reportes/mas-vendidos', (req, res) => {
  const sql = `
    SELECT p.id, p.nombre, COUNT(m.id) AS total_salidas
    FROM productos p
    LEFT JOIN movimientos_inventario m
      ON p.id = m.producto_id AND m.tipo = 'salida'
    GROUP BY p.id, p.nombre
    ORDER BY total_salidas DESC
  `;

  db.query(sql, (err, results) => {
    if (err) return enviarError(res, err);
    return res.json(results);
  });
});

    /* =========================
       ERP - ÓRDENES EMPRESARIALES
    ========================= */

    /* Crear orden empresarial */
    app.post('/api/ordenes', (req, res) => {
      const { cliente_id, usuario_id, productos } = req.body;

      if (!cliente_id || !usuario_id || !Array.isArray(productos) || productos.length === 0) {
        return res.status(400).json({
          ok: false,
          message: 'Faltan datos obligatorios para crear la orden'
        });
      }

      let total = 0;

      const productoIds = productos.map(p => p.producto_id);
      if (productoIds.some(id => !id)) {
        return res.status(400).json({
          ok: false,
          message: 'Todos los productos deben tener producto_id'
        });
      }

      db.query(
        `SELECT id, nombre, precio_venta, stock_actual
         FROM productos
         WHERE id IN (?)`,
        [productoIds],
        (err, productosDb) => {
          if (err) return enviarError(res, err);

          if (productosDb.length !== productoIds.length) {
            return res.status(400).json({
              ok: false,
              message: 'Uno o más productos no existen'
            });
          }

          const mapaProductos = {};
          productosDb.forEach(p => mapaProductos[p.id] = p);

          const itemsCalculados = [];

          for (const item of productos) {
            const prod = mapaProductos[item.producto_id];
            const cantidad = Number(item.cantidad || 0);

            if (cantidad <= 0) {
              return res.status(400).json({
                ok: false,
                message: 'La cantidad debe ser mayor a 0'
              });
            }

            const precio = Number(prod.precio_venta || 0);
            const subtotal = precio * cantidad;
            total += subtotal;

            itemsCalculados.push({
              producto_id: prod.id,
              cantidad,
              precio_unitario: precio,
              subtotal
            });
          }

          db.query(
            `INSERT INTO ordenes_empresariales (cliente_id, usuario_id, total, estado)
             VALUES (?, ?, ?, 'pendiente')`,
            [cliente_id, usuario_id, total],
            (err2, result) => {
              if (err2) return enviarError(res, err2);

              const ordenId = result.insertId;

              const values = itemsCalculados.map(i => [
                ordenId,
                i.producto_id,
                i.cantidad,
                i.precio_unitario,
                i.subtotal
              ]);

              db.query(
                `INSERT INTO orden_items (orden_id, producto_id, cantidad, precio_unitario, subtotal)
                 VALUES ?`,
                [values],
                (err3) => {
                  if (err3) return enviarError(res, err3);

                  return res.json({
                    ok: true,
                    message: 'Orden creada correctamente',
                    id: ordenId,
                    total
                  });
                }
              );
            }
          );
        }
      );
    });

    /* Obtener órdenes */
    app.get('/api/ordenes', (req, res) => {
      const sql = `
        SELECT o.*, c.nombre AS cliente_nombre, u.nombre AS usuario_nombre
        FROM ordenes_empresariales o
        INNER JOIN clientes c ON o.cliente_id = c.id
        INNER JOIN usuarios u ON o.usuario_id = u.id
        ORDER BY o.id DESC
      `;

      db.query(sql, (err, results) => {
        if (err) return enviarError(res, err);
        return res.json(results);
      });
    });

    /* Obtener orden por id */
    app.get('/api/ordenes/:id', (req, res) => {
      const { id } = req.params;

      const sqlOrden = `
        SELECT o.*, c.nombre AS cliente_nombre, u.nombre AS usuario_nombre
        FROM ordenes_empresariales o
        INNER JOIN clientes c ON o.cliente_id = c.id
        INNER JOIN usuarios u ON o.usuario_id = u.id
        WHERE o.id = ?
      `;

      db.query(sqlOrden, [id], (err, ordenRes) => {
        if (err) return enviarError(res, err);

        if (ordenRes.length === 0) {
          return res.status(404).json({
            ok: false,
            message: 'Orden no encontrada'
          });
        }

        db.query(
          `SELECT oi.*, p.nombre AS producto_nombre
           FROM orden_items oi
           INNER JOIN productos p ON oi.producto_id = p.id
           WHERE oi.orden_id = ?`,
          [id],
          (err2, itemsRes) => {
            if (err2) return enviarError(res, err2);

            return res.json({
              ...ordenRes[0],
              items: itemsRes
            });
          }
        );
      });
    });

    /* Cambiar estado de orden */
    app.put('/api/ordenes/:id/estado', (req, res) => {
      const { id } = req.params;
      const { estado } = req.body;

      const estadosValidos = ['pendiente', 'procesada', 'cancelada'];
      if (!estadosValidos.includes(estado)) {
        return res.status(400).json({
          ok: false,
          message: 'Estado no válido'
        });
      }

      db.query(
        `UPDATE ordenes_empresariales SET estado = ? WHERE id = ?`,
        [estado, id],
        (err) => {
          if (err) return enviarError(res, err);

          return res.json({
            ok: true,
            message: 'Estado de la orden actualizado correctamente'
          });
        }
      );
    });

    /* =========================
       ERP - PROCESAR ORDEN
    ========================= */

    app.post('/api/ordenes/procesar', (req, res) => {
      const { orden_id } = req.body;

      if (!orden_id) {
        return res.status(400).json({
          ok: false,
          message: 'Falta el id de la orden'
        });
      }

      db.query(
        `SELECT * FROM ordenes_empresariales WHERE id = ?`,
        [orden_id],
        (err, ordenRes) => {
          if (err) return enviarError(res, err);

          if (ordenRes.length === 0) {
            return res.status(404).json({
              ok: false,
              message: 'Orden no encontrada'
            });
          }

          const orden = ordenRes[0];

          if (orden.estado === 'procesada') {
            return res.status(400).json({
              ok: false,
              message: 'La orden ya fue procesada'
            });
          }

          db.query(
            `SELECT * FROM orden_items WHERE orden_id = ?`,
            [orden_id],
            (err2, itemsRes) => {
              if (err2) return enviarError(res, err2);

              if (!itemsRes.length) {
                return res.status(400).json({
                  ok: false,
                  message: 'La orden no tiene productos'
                });
              }

              const productoIds = itemsRes.map(i => i.producto_id);

              db.query(
                `SELECT * FROM productos WHERE id IN (?)`,
                [productoIds],
                (err3, productosRes) => {
                  if (err3) return enviarError(res, err3);

                  const mapaProductos = {};
                  productosRes.forEach(p => mapaProductos[p.id] = p);

                  for (const item of itemsRes) {
                    const prod = mapaProductos[item.producto_id];
                    if (!prod || Number(prod.stock_actual) < Number(item.cantidad)) {
                      return res.status(400).json({
                        ok: false,
                        message: `Stock insuficiente para el producto ID ${item.producto_id}`
                      });
                    }
                  }

                  let pendientes = itemsRes.length;
                  let errorEnProceso = false;

                  itemsRes.forEach(item => {
                    const prod = mapaProductos[item.producto_id];
                    const nuevoStock = Number(prod.stock_actual) - Number(item.cantidad);

                    db.query(
                      `UPDATE productos SET stock_actual = ? WHERE id = ?`,
                      [nuevoStock, item.producto_id],
                      (err4) => {
                        if (errorEnProceso) return;
                        if (err4) {
                          errorEnProceso = true;
                          return enviarError(res, err4);
                        }

                        db.query(
                          `INSERT INTO movimientos_inventario (producto_id, tipo, cantidad, motivo)
                           VALUES (?, 'salida', ?, 'venta')`,
                          [item.producto_id, item.cantidad],
                          (err5) => {
                            if (errorEnProceso) return;
                            if (err5) {
                              errorEnProceso = true;
                              return enviarError(res, err5);
                            }

                            pendientes--;

                            if (pendientes === 0) {
                              db.query(
                                `UPDATE ordenes_empresariales SET estado = 'procesada' WHERE id = ?`,
                                [orden_id],
                                (err6) => {
                                  if (err6) return enviarError(res, err6);

                                  return res.json({
                                    ok: true,
                                    message: 'Orden procesada correctamente. Inventario actualizado y movimientos registrados.'
                                  });
                                }
                              );
                            }
                          }
                        );
                      }
                    );
                  });
                }
              );
            }
          );
        }
      );
    });

    /* =========================
       ERP - ESTADO
    ========================= */

    app.get('/api/erp/estado', (req, res) => {
      db.query(`SELECT * FROM estado_erp ORDER BY id ASC LIMIT 1`, (err, results) => {
        if (err) return enviarError(res, err);

        if (!results.length) {
          return res.status(404).json({
            ok: false,
            message: 'No se encontró el estado ERP'
          });
        }

        return res.json(results[0]);
      });
    });

    app.put('/api/erp/estado', (req, res) => {
      const { nivel } = req.body;

      const nivelesValidos = ['Básico', 'Integrado', 'Automatizado', 'Optimizado'];
      if (!nivelesValidos.includes(nivel)) {
        return res.status(400).json({
          ok: false,
          message: 'Nivel ERP no válido'
        });
      }

      db.query(
        `UPDATE estado_erp SET nivel = ? WHERE id = 1`,
        [nivel],
        (err) => {
          if (err) return enviarError(res, err);

          return res.json({
            ok: true,
            message: 'Estado ERP actualizado correctamente'
          });
        }
      );
    });

    /* =========================
       ERP - MÉTRICAS
    ========================= */

    app.get('/api/erp/metricas', (req, res) => {
      const metricas = {};

      db.query(
        `SELECT IFNULL(SUM(total), 0) AS ventas_totales
         FROM ordenes_empresariales
         WHERE estado = 'procesada'`,
        (err, ventasRes) => {
          if (err) return enviarError(res, err);
          metricas.ventas_totales = ventasRes[0].ventas_totales;

          db.query(
            `SELECT COUNT(*) AS ordenes_procesadas
             FROM ordenes_empresariales
             WHERE estado = 'procesada'`,
            (err2, ordenesRes) => {
              if (err2) return enviarError(res, err2);
              metricas.ordenes_procesadas = ordenesRes[0].ordenes_procesadas;

              db.query(
                `SELECT IFNULL(SUM(cantidad), 0) AS productos_vendidos
                 FROM orden_items oi
                 INNER JOIN ordenes_empresariales o ON oi.orden_id = o.id
                 WHERE o.estado = 'procesada'`,
                (err3, productosVendidosRes) => {
                  if (err3) return enviarError(res, err3);
                  metricas.productos_vendidos = productosVendidosRes[0].productos_vendidos;

                  db.query(
                    `SELECT COUNT(*) AS clientes_activos
                     FROM clientes
                     WHERE estado = 'activo'`,
                    (err4, clientesRes) => {
                      if (err4) return enviarError(res, err4);
                      metricas.clientes_activos = clientesRes[0].clientes_activos;

                      db.query(
                        `SELECT IFNULL(SUM(stock_actual), 0) AS inventario_disponible
                         FROM productos`,
                        (err5, inventarioRes) => {
                          if (err5) return enviarError(res, err5);
                          metricas.inventario_disponible = inventarioRes[0].inventario_disponible;

                          return res.json(metricas);
                        }
                      );
                    }
                  );
                }
              );
            }
          );
        }
      );
    });

 /* =========================
   ETAPA 4 - CATÁLOGO
========================= */

app.get('/api/catalogo', (req, res) => {
  const { categoria, buscar } = req.query;

  let sql = `
    SELECT
      p.id,
      p.nombre,
      p.descripcion,
      p.categoria,
      p.stock_actual,
      p.stock_minimo,
      p.precio_venta AS precio,
      p.costo_unitario,
      p.precio_venta,
      p.imagen_url,
      p.estado,
      p.destacado,
      p.estrategia_logistica,
      pr.nombre AS proveedor_nombre
    FROM productos p
    LEFT JOIN proveedores pr ON p.proveedor_id = pr.id
    WHERE p.estado = 'activo'
  `;

  const params = [];

  if (categoria) {
    sql += ' AND p.categoria = ?';
    params.push(categoria);
  }

  if (buscar) {
    sql += ' AND p.nombre LIKE ?';
    params.push(`%${buscar}%`);
  }

  sql += ' ORDER BY p.destacado DESC, p.id DESC';

  db.query(sql, params, (err, results) => {
    if (err) return enviarError(res, err);
    return res.json(results);
  });
});

app.get('/api/catalogo/:id', (req, res) => {
  const { id } = req.params;

  const sql = `
    SELECT
      p.id,
      p.nombre,
      p.descripcion,
      p.categoria,
      p.stock_actual,
      p.stock_minimo,
      p.precio_venta AS precio,
      p.costo_unitario,
      p.precio_venta,
      p.imagen_url,
      p.estado,
      p.destacado,
      p.estrategia_logistica,
      pr.nombre AS proveedor_nombre,
      pr.contacto AS proveedor_contacto,
      pr.correo AS proveedor_correo,
      pr.telefono AS proveedor_telefono
    FROM productos p
    LEFT JOIN proveedores pr ON p.proveedor_id = pr.id
    WHERE p.id = ? AND p.estado = 'activo'
    LIMIT 1
  `;

  db.query(sql, [id], (err, results) => {
    if (err) return enviarError(res, err);

    if (!results.length) {
      return res.status(404).json({
        ok: false,
        message: 'Producto no encontrado'
      });
    }

    return res.json(results[0]);
  });
});
/* =========================
   ETAPA 4 - CARRITO
========================= */

/* Ver carrito por cliente */
app.get('/api/carrito/:cliente_id', (req, res) => {
  const { cliente_id } = req.params;

  const sql = `
    SELECT 
      cd.id,
      cd.carrito_id,
      cd.producto_id,
      cd.cantidad,
      cd.precio_unitario,
      (cd.cantidad * cd.precio_unitario) AS subtotal,
      p.nombre,
      p.descripcion,
      p.categoria,
      p.stock_actual,
      p.imagen_url
    FROM carrito c
    INNER JOIN carrito_detalle cd ON c.id = cd.carrito_id
    INNER JOIN productos p ON cd.producto_id = p.id
    WHERE c.cliente_id = ? AND c.estado = 'activo'
    ORDER BY cd.id DESC
  `;

  db.query(sql, [cliente_id], (err, results) => {
    if (err) return enviarError(res, err);
    return res.json(results);
  });
});

/* Agregar producto al carrito */
app.post('/api/carrito/agregar', (req, res) => {
  const { cliente_id, producto_id, cantidad } = req.body;

  if (!cliente_id || !producto_id || !cantidad) {
    return res.status(400).json({
      ok: false,
      message: 'Faltan datos para agregar al carrito'
    });
  }

  db.query(
    "SELECT * FROM productos WHERE id = ? AND estado = 'activo'",
    [producto_id],
    (err, prodRes) => {
      if (err) return enviarError(res, err);

      if (!prodRes.length) {
        return res.status(404).json({
          ok: false,
          message: 'Producto no encontrado'
        });
      }

      const producto = prodRes[0];

      if (Number(cantidad) <= 0) {
        return res.status(400).json({
          ok: false,
          message: 'La cantidad debe ser mayor a 0'
        });
      }

      if (Number(producto.stock_actual) < Number(cantidad)) {
        return res.status(400).json({
          ok: false,
          message: 'Stock insuficiente para agregar al carrito'
        });
      }

      db.query(
        "SELECT * FROM carrito WHERE cliente_id = ? AND estado = 'activo' LIMIT 1",
        [cliente_id],
        (err2, carritoRes) => {
          if (err2) return enviarError(res, err2);

          const crearDetalle = (carritoId) => {
            db.query(
              'SELECT * FROM carrito_detalle WHERE carrito_id = ? AND producto_id = ? LIMIT 1',
              [carritoId, producto_id],
              (err3, detalleRes) => {
                if (err3) return enviarError(res, err3);

                if (detalleRes.length > 0) {
                  const nuevaCantidad = Number(detalleRes[0].cantidad) + Number(cantidad);

                  if (nuevaCantidad > Number(producto.stock_actual)) {
                    return res.status(400).json({
                      ok: false,
                      message: 'La cantidad solicitada supera el stock disponible'
                    });
                  }

                  db.query(
                    'UPDATE carrito_detalle SET cantidad = ? WHERE id = ?',
                    [nuevaCantidad, detalleRes[0].id],
                    (err4) => {
                      if (err4) return enviarError(res, err4);

                      return res.json({
                        ok: true,
                        message: 'Cantidad del producto actualizada en el carrito'
                      });
                    }
                  );
                } else {
                  db.query(
                    `INSERT INTO carrito_detalle (carrito_id, producto_id, cantidad, precio_unitario)
                     VALUES (?, ?, ?, ?)`,
                    [carritoId, producto_id, cantidad, producto.precio_venta],
                    (err5) => {
                      if (err5) return enviarError(res, err5);

                      return res.json({
                        ok: true,
                        message: 'Producto agregado al carrito correctamente'
                      });
                    }
                  );
                }
              }
            );
          };

          if (carritoRes.length > 0) {
            crearDetalle(carritoRes[0].id);
          } else {
            db.query(
              "INSERT INTO carrito (cliente_id, estado) VALUES (?, 'activo')",
              [cliente_id],
              (err6, result) => {
                if (err6) return enviarError(res, err6);
                crearDetalle(result.insertId);
              }
            );
          }
        }
      );
    }
  );
});

/* Editar cantidad de item del carrito */
app.put('/api/carrito/item/:id', (req, res) => {
  const { id } = req.params;
  const { cantidad } = req.body;

  if (!cantidad || Number(cantidad) <= 0) {
    return res.status(400).json({
      ok: false,
      message: 'La cantidad debe ser mayor a 0'
    });
  }

  const sql = `
    SELECT cd.*, p.stock_actual
    FROM carrito_detalle cd
    INNER JOIN productos p ON cd.producto_id = p.id
    WHERE cd.id = ?
    LIMIT 1
  `;

  db.query(sql, [id], (err, results) => {
    if (err) return enviarError(res, err);

    if (!results.length) {
      return res.status(404).json({
        ok: false,
        message: 'Item de carrito no encontrado'
      });
    }

    const item = results[0];

    if (Number(cantidad) > Number(item.stock_actual)) {
      return res.status(400).json({
        ok: false,
        message: 'La cantidad supera el stock disponible'
      });
    }

    db.query(
      'UPDATE carrito_detalle SET cantidad = ? WHERE id = ?',
      [cantidad, id],
      (err2) => {
        if (err2) return enviarError(res, err2);

        return res.json({
          ok: true,
          message: 'Cantidad actualizada correctamente'
        });
      }
    );
  });
});

/* Eliminar item del carrito */
app.delete('/api/carrito/item/:id', (req, res) => {
  const { id } = req.params;

  db.query(
    'DELETE FROM carrito_detalle WHERE id = ?',
    [id],
    (err) => {
      if (err) return enviarError(res, err);

      return res.json({
        ok: true,
        message: 'Producto eliminado del carrito'
      });
    }
  );
});

/* Vaciar carrito */
app.delete('/api/carrito/vaciar/:cliente_id', (req, res) => {
  const { cliente_id } = req.params;

  db.query(
    "SELECT * FROM carrito WHERE cliente_id = ? AND estado = 'activo' LIMIT 1",
    [cliente_id],
    (err, carritoRes) => {
      if (err) return enviarError(res, err);

      if (!carritoRes.length) {
        return res.json({
          ok: true,
          message: 'El carrito ya estaba vacío'
        });
      }

      const carritoId = carritoRes[0].id;

      db.query(
        'DELETE FROM carrito_detalle WHERE carrito_id = ?',
        [carritoId],
        (err2) => {
          if (err2) return enviarError(res, err2);

          return res.json({
            ok: true,
            message: 'Carrito vaciado correctamente'
          });
        }
      );
    }
  );
});

/* =========================
   ETAPA 4 - CHECKOUT / PAGOS
========================= */
app.post('/api/pagos/procesar', (req, res) => {
  const { cliente_id, metodo_pago, usuario_id, factura } = req.body;

  if (!cliente_id || !metodo_pago) {
    return res.status(400).json({
      ok: false,
      message: 'Faltan datos para procesar el pago'
    });
  }

  const metodosValidos = ['tarjeta', 'spei', 'oxxo', 'paypal', 'efectivo'];
  if (!metodosValidos.includes(metodo_pago)) {
    return res.status(400).json({
      ok: false,
      message: 'Método de pago no válido'
    });
  }

  db.query(
    "SELECT * FROM carrito WHERE cliente_id = ? AND estado = 'activo' LIMIT 1",
    [cliente_id],
    (err, carritoRes) => {
      if (err) return enviarError(res, err);

      if (!carritoRes.length) {
        return res.status(404).json({
          ok: false,
          message: 'No existe un carrito activo para este cliente'
        });
      }

      const carrito = carritoRes[0];

      const sqlItems = `
        SELECT 
          cd.id,
          cd.carrito_id,
          cd.producto_id,
          cd.cantidad,
          cd.precio_unitario,
          p.nombre,
          p.stock_actual,
          p.stock_minimo,
          p.estrategia_logistica
        FROM carrito_detalle cd
        INNER JOIN productos p ON cd.producto_id = p.id
        WHERE cd.carrito_id = ?
      `;

      db.query(sqlItems, [carrito.id], (err2, itemsRes) => {
        if (err2) return enviarError(res, err2);

        if (!itemsRes.length) {
          return res.status(400).json({
            ok: false,
            message: 'El carrito está vacío'
          });
        }

        const productoIds = itemsRes.map(item => item.producto_id);

        db.query(
          `
          SELECT *
          FROM promociones
          WHERE estado = 'activo'
            AND producto_id IN (?)
            AND (fecha_inicio IS NULL OR fecha_inicio <= CURDATE())
            AND (fecha_fin IS NULL OR fecha_fin >= CURDATE())
          ORDER BY id DESC
          `,
          [productoIds],
          (errPromo, promoRes) => {
            if (errPromo) return enviarError(res, errPromo);

            const promosMap = {};
            promoRes.forEach(promo => {
              if (!promosMap[promo.producto_id]) {
                promosMap[promo.producto_id] = promo;
              }
            });

            let subtotalOriginal = 0;
            let descuentoTotal = 0;

            const itemsCalculados = [];

            for (const item of itemsRes) {
              if (Number(item.cantidad) > Number(item.stock_actual)) {
                return res.status(400).json({
                  ok: false,
                  message: `Stock insuficiente para ${item.nombre}`
                });
              }

              const cantidad = Number(item.cantidad || 0);
              const precioBase = Number(item.precio_unitario || 0);
              const subtotalBase = precioBase * cantidad;

              let precioFinal = precioBase;
              let subtotalFinal = subtotalBase;
              let descuentoAplicado = 0;

              const promo = promosMap[item.producto_id];

              if (promo) {
                const porcentaje = Number(promo.valor_descuento || 0);
                descuentoAplicado = subtotalBase * (porcentaje / 100);
                subtotalFinal = subtotalBase - descuentoAplicado;
                precioFinal = cantidad > 0 ? subtotalFinal / cantidad : precioBase;
              }

              subtotalOriginal += subtotalBase;
              descuentoTotal += descuentoAplicado;

              itemsCalculados.push({
                ...item,
                precio_base: precioBase,
                precio_final: precioFinal,
                subtotal_base: subtotalBase,
                subtotal_final: subtotalFinal,
                descuento_aplicado: descuentoAplicado
              });
            }

            const subtotal = subtotalOriginal - descuentoTotal;

            db.query(
              `SELECT *
               FROM impuestos
               WHERE estado = 'activo'
               ORDER BY id DESC
               LIMIT 1`,
              (errImpuesto, impuestoRes) => {
                if (errImpuesto) return enviarError(res, errImpuesto);

                const impuestoActivo = impuestoRes.length
                  ? impuestoRes[0]
                  : { nombre: 'IVA', porcentaje: 0 };

                const porcentajeImpuesto = Number(impuestoActivo.porcentaje || 0);
                const montoImpuesto = subtotal * (porcentajeImpuesto / 100);
                const total = subtotal + montoImpuesto;

                const usuarioResponsable = usuario_id || 3;

                db.query(
                  `INSERT INTO ordenes_empresariales (cliente_id, usuario_id, total, estado)
                   VALUES (?, ?, ?, 'pendiente')`,
                  [cliente_id, usuarioResponsable, total],
                  (err3, ordenRes) => {
                    if (err3) return enviarError(res, err3);

                    const ordenId = ordenRes.insertId;

                    const values = itemsCalculados.map(item => [
                      ordenId,
                      item.producto_id,
                      item.cantidad,
                      item.precio_final,
                      item.subtotal_final
                    ]);

                    db.query(
                      `INSERT INTO orden_items (orden_id, producto_id, cantidad, precio_unitario, subtotal)
                       VALUES ?`,
                      [values],
                      (err4) => {
                        if (err4) return enviarError(res, err4);

                        db.query(
                          `INSERT INTO pagos (orden_id, monto, metodo_pago, estado)
                           VALUES (?, ?, ?, 'pagado')`,
                          [ordenId, total, metodo_pago],
                          (err5, pagoRes) => {
                            if (err5) return enviarError(res, err5);

                            let pendientes = itemsCalculados.length;
                            let errorEnProceso = false;

                            itemsCalculados.forEach(item => {
                              const nuevoStock = Number(item.stock_actual) - Number(item.cantidad);

                              db.query(
                                `UPDATE productos SET stock_actual = ? WHERE id = ?`,
                                [nuevoStock, item.producto_id],
                                (err6) => {
                                  if (errorEnProceso) return;

                                  if (err6) {
                                    errorEnProceso = true;
                                    return enviarError(res, err6);
                                  }

                                  db.query(
                                    `INSERT INTO movimientos_inventario (producto_id, tipo, cantidad, motivo)
                                     VALUES (?, 'salida', ?, 'venta ecommerce')`,
                                    [item.producto_id, item.cantidad],
                                    (err7) => {
                                      if (errorEnProceso) return;

                                      if (err7) {
                                        errorEnProceso = true;
                                        return enviarError(res, err7);
                                      }

                                      if (
                                        item.estrategia_logistica === 'PUSH' &&
                                        nuevoStock <= Number(item.stock_minimo)
                                      ) {
                                        const cantidadReposicion = Math.max(Number(item.stock_minimo) * 2, 10);

                                        db.query(
                                          `INSERT INTO pedidos (producto_id, cantidad, tipo, estado)
                                           VALUES (?, ?, 'reposicion', 'pendiente')`,
                                          [item.producto_id, cantidadReposicion],
                                          (err8) => {
                                            if (errorEnProceso) return;

                                            if (err8) {
                                              errorEnProceso = true;
                                              return enviarError(res, err8);
                                            }

                                            pendientes--;

                                            if (pendientes === 0) {
                                              finalizarCheckout();
                                            }
                                          }
                                        );
                                      } else {
                                        pendientes--;

                                        if (pendientes === 0) {
                                          finalizarCheckout();
                                        }
                                      }
                                    }
                                  );
                                }
                              );
                            });

                            function finalizarCheckout() {
                              db.query(
                                `UPDATE ordenes_empresariales SET estado = 'procesada' WHERE id = ?`,
                                [ordenId],
                                (err9) => {
                                  if (err9) return enviarError(res, err9);

                                  db.query(
                                    `INSERT INTO seguimiento_pedidos (orden_id, estado, comentario)
                                     VALUES (?, 'preparacion', 'Tu pedido está siendo preparado')`,
                                    [ordenId],
                                    (errSeguimiento) => {
                                      if (errSeguimiento) return enviarError(res, errSeguimiento);

                                      const requiereFactura = factura && factura.requiere_factura === true;
                                      const folioRecibo = `RCB-${ordenId}`;

                                      db.query(
                                        `SELECT nombre, correo FROM clientes WHERE id = ? LIMIT 1`,
                                        [cliente_id],
                                        (errClienteBase, clienteBaseRes) => {
                                          if (errClienteBase) return enviarError(res, errClienteBase);

                                          const clienteBase = clienteBaseRes.length
                                            ? clienteBaseRes[0]
                                            : { nombre: 'Cliente', correo: '' };

                                          db.query(
                                            `INSERT INTO recibos (
                                              orden_id,
                                              folio,
                                              cliente_nombre,
                                              negocio,
                                              metodo_pago,
                                              subtotal_original,
                                              descuento_monto,
                                              subtotal,
                                              impuesto_nombre,
                                              impuesto_porcentaje,
                                              impuesto_monto,
                                              total
                                            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                                            [
                                              ordenId,
                                              folioRecibo,
                                              clienteBase.nombre || 'Cliente',
                                              'Ballers',
                                              metodo_pago,
                                              subtotalOriginal,
                                              descuentoTotal,
                                              subtotal,
                                              impuestoActivo.nombre || 'IVA',
                                              porcentajeImpuesto,
                                              montoImpuesto,
                                              total
                                            ],
                                            (errRecibo) => {
                                              if (errRecibo) return enviarError(res, errRecibo);

                                              const cerrarCarritoYResponder = () => {
                                                db.query(
                                                  `UPDATE carrito SET estado = 'cerrado' WHERE id = ?`,
                                                  [carrito.id],
                                                  (err10) => {
                                                    if (err10) return enviarError(res, err10);

                                                    db.query(
                                                      `DELETE FROM carrito_detalle WHERE carrito_id = ?`,
                                                      [carrito.id],
                                                      (err11) => {
                                                        if (err11) return enviarError(res, err11);

                                                        return res.json({
                                                          ok: true,
                                                          message: 'Pago procesado correctamente',
                                                          orden_id: ordenId,
                                                          pago_id: pagoRes.insertId,
                                                          subtotal_original: subtotalOriginal,
                                                          descuento_monto: descuentoTotal,
                                                          subtotal,
                                                          impuesto_nombre: impuestoActivo.nombre || 'IVA',
                                                          impuesto_porcentaje: porcentajeImpuesto,
                                                          impuesto_monto: montoImpuesto,
                                                          total
                                                        });
                                                      }
                                                    );
                                                  }
                                                );
                                              };

                                              if (!requiereFactura) {
                                                return cerrarCarritoYResponder();
                                              }

                                              const folioFactura = `FCT-${String(Date.now()).slice(-6)}`;
                                              const fechaFactura = new Date().toISOString().slice(0, 10);
                                              const huellaDigital = '00000123456789ABCDEF00112233445566778899AABBCCDDEEFF0011223344556677';

                                              db.query(
                                                `INSERT INTO facturas (
                                                  orden_id,
                                                  folio,
                                                  fecha,
                                                  uso_cfdi,
                                                  rfc_cliente,
                                                  nombre_cliente,
                                                  razon_social_cliente,
                                                  correo_factura,
                                                  rfc_negocio,
                                                  razon_social_negocio,
                                                  total,
                                                  certificado_expedido_a,
                                                  valido_por,
                                                  huella_digital
                                                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                                                [
                                                  ordenId,
                                                  folioFactura,
                                                  fechaFactura,
                                                  factura?.uso_cfdi || 'G03 - Gastos en general',
                                                  factura?.rfc || 'XAXX010101000',
                                                  clienteBase.nombre || 'Cliente',
                                                  factura?.razon_social || 'Cliente',
                                                  factura?.correo_factura || clienteBase.correo || '',
                                                  'DEMO123456XX0',
                                                  'Ballers',
                                                  total,
                                                  'Ballers',
                                                  String(new Date().getFullYear()),
                                                  huellaDigital
                                                ],
                                                (errFactura) => {
                                                  if (errFactura) return enviarError(res, errFactura);
                                                  return cerrarCarritoYResponder();
                                                }
                                              );
                                            }
                                          );
                                        }
                                      );
                                    }
                                  );
                                }
                              );
                            }
                          }
                        );
                      }
                    );
                  }
                );
              }
            );
          }
        );
      });
    }
  );
});
/* =========================
   ETAPA 4 - IMPUESTOS
========================= */

/* Obtener impuesto activo */
app.get('/api/impuestos/activo', (req, res) => {
  const sql = `
    SELECT *
    FROM impuestos
    WHERE estado = 'activo'
    ORDER BY id DESC
    LIMIT 1
  `;

  db.query(sql, (err, results) => {
    if (err) return enviarError(res, err);

    if (!results.length) {
      return res.status(404).json({
        ok: false,
        message: 'No hay impuesto activo configurado'
      });
    }

    return res.json({
      ok: true,
      impuesto: results[0]
    });
  });
});

/* Obtener todos los impuestos */
app.get('/api/impuestos', (req, res) => {
  const sql = `
    SELECT *
    FROM impuestos
    ORDER BY id DESC
  `;

  db.query(sql, (err, results) => {
    if (err) return enviarError(res, err);

    return res.json({
      ok: true,
      impuestos: results
    });
  });
});

/* Actualizar impuesto */
app.put('/api/impuestos/:id', (req, res) => {
  const { id } = req.params;
  const { nombre, porcentaje, estado } = req.body;

  if (!nombre || porcentaje === undefined || porcentaje === null || !estado) {
    return res.status(400).json({
      ok: false,
      message: 'Faltan datos obligatorios'
    });
  }

  const porcentajeNum = Number(porcentaje);

  if (isNaN(porcentajeNum) || porcentajeNum < 0) {
    return res.status(400).json({
      ok: false,
      message: 'Porcentaje no válido'
    });
  }

  if (!['activo', 'inactivo'].includes(estado)) {
    return res.status(400).json({
      ok: false,
      message: 'Estado no válido'
    });
  }

  const sql = `
    UPDATE impuestos
    SET nombre = ?, porcentaje = ?, estado = ?, actualizado_en = NOW()
    WHERE id = ?
  `;

  db.query(sql, [nombre, porcentajeNum, estado, id], (err, result) => {
    if (err) return enviarError(res, err);

    if (result.affectedRows === 0) {
      return res.status(404).json({
        ok: false,
        message: 'Impuesto no encontrado'
      });
    }

    return res.json({
      ok: true,
      message: 'Impuesto actualizado correctamente'
    });
  });
});

/* =========================
   ETAPA 4 - FACTURA
========================= */
app.get('/api/factura/:orden_id', (req, res) => {
  const { orden_id } = req.params;

  const sql = `
    SELECT
      f.id,
      f.orden_id,
      f.folio,
      f.fecha,
      f.uso_cfdi,
      f.rfc_cliente,
      f.nombre_cliente,
      f.razon_social_cliente,
      f.correo_factura,
      f.rfc_negocio,
      f.razon_social_negocio,
      f.total,
      f.certificado_expedido_a,
      f.valido_por,
      f.huella_digital,
      r.subtotal_original,
      r.descuento_monto,
      r.subtotal,
      r.impuesto_nombre,
      r.impuesto_porcentaje,
      r.impuesto_monto
    FROM facturas f
    LEFT JOIN recibos r ON f.orden_id = r.orden_id
    WHERE f.orden_id = ?
    LIMIT 1
  `;

  db.query(sql, [orden_id], (err, results) => {
    if (err) return enviarError(res, err);

    if (!results.length) {
      return res.status(404).json({
        ok: false,
        message: 'Factura no encontrada'
      });
    }

    const factura = results[0];

    return res.json({
      ok: true,
      factura: {
        ...factura,
        subtotal_original: Number(factura.subtotal_original || 0),
        descuento_monto: Number(factura.descuento_monto || 0),
        subtotal: Number(factura.subtotal || 0),
        impuesto_nombre: factura.impuesto_nombre || 'IVA',
        impuesto_porcentaje: Number(factura.impuesto_porcentaje || 0),
        impuesto_monto: Number(factura.impuesto_monto || 0),
        total: Number(factura.total || 0)
      }
    });
  });
});

app.post('/api/factura/enviar-correo', (req, res) => {
  const { orden_id, correo } = req.body;

  if (!orden_id || !correo) {
    return res.status(400).json({
      ok: false,
      message: 'Faltan datos para enviar la factura'
    });
  }

  const sql = `
    SELECT
      f.id,
      f.orden_id,
      f.folio,
      f.fecha,
      f.uso_cfdi,
      f.rfc_cliente,
      f.nombre_cliente,
      f.razon_social_cliente,
      f.correo_factura,
      f.rfc_negocio,
      f.razon_social_negocio,
      f.total,
      f.certificado_expedido_a,
      f.valido_por,
      f.huella_digital,
      r.subtotal_original,
      r.descuento_monto,
      r.subtotal,
      r.impuesto_nombre,
      r.impuesto_porcentaje,
      r.impuesto_monto
    FROM facturas f
    LEFT JOIN recibos r ON f.orden_id = r.orden_id
    WHERE f.orden_id = ?
    LIMIT 1
  `;

  db.query(sql, [orden_id], async (err, results) => {
    if (err) return enviarError(res, err);

    if (!results.length) {
      return res.status(404).json({
        ok: false,
        message: 'Factura no encontrada'
      });
    }

    const factura = results[0];

    try {
      const html = `
        <div style="font-family:Arial,sans-serif;color:#111;">
          <h2>Ballers - Factura electrónica</h2>

          <p><strong>Folio:</strong> ${factura.folio || '-'}</p>
          <p><strong>Pedido:</strong> PED-${factura.orden_id}</p>
          <p><strong>Fecha:</strong> ${factura.fecha || '-'}</p>
          <p><strong>Uso CFDI:</strong> ${factura.uso_cfdi || '-'}</p>

          <h3>Datos fiscales</h3>
          <p><strong>RFC cliente:</strong> ${factura.rfc_cliente || '-'}</p>
          <p><strong>Nombre cliente:</strong> ${factura.nombre_cliente || '-'}</p>
          <p><strong>Razón social cliente:</strong> ${factura.razon_social_cliente || '-'}</p>
          <p><strong>Correo de facturación:</strong> ${factura.correo_factura || '-'}</p>
          <p><strong>RFC negocio:</strong> ${factura.rfc_negocio || '-'}</p>
          <p><strong>Razón social negocio:</strong> ${factura.razon_social_negocio || 'Ballers'}</p>

          <h3>Totales</h3>
          <p><strong>Subtotal original:</strong> $${Number(factura.subtotal_original || 0).toFixed(2)}</p>
          <p><strong>Descuento:</strong> $${Number(factura.descuento_monto || 0).toFixed(2)}</p>
          <p><strong>Subtotal:</strong> $${Number(factura.subtotal || 0).toFixed(2)}</p>
          <p><strong>${factura.impuesto_nombre || 'IVA'} (${Number(factura.impuesto_porcentaje || 0)}%):</strong> $${Number(factura.impuesto_monto || 0).toFixed(2)}</p>
          <p><strong>Total:</strong> $${Number(factura.total || 0).toFixed(2)}</p>

          <h3>Sello digital</h3>
          <p><strong>Certificado expedido a:</strong> ${factura.certificado_expedido_a || 'Ballers'}</p>
          <p><strong>Válido por:</strong> ${factura.valido_por || new Date().getFullYear()}</p>
          <p><strong>Huella digital:</strong> ${factura.huella_digital || '-'}</p>
        </div>
      `;

      await enviarCorreo({
        to: correo,
        subject: `Factura Ballers ${factura.folio}`,
        html
      });

      return res.json({
        ok: true,
        message: 'Factura enviada correctamente al correo'
      });
    } catch (mailError) {
      return enviarError(res, mailError, 'No se pudo enviar la factura al correo');
    }
  });
});
/* =========================
   ETAPA 4 - RECIBO
========================= */
app.get('/api/recibo/orden/:orden_id', (req, res) => {
  const { orden_id } = req.params;

  db.query(
    `SELECT *
     FROM recibos
     WHERE orden_id = ?
     LIMIT 1`,
    [orden_id],
    (err, reciboRes) => {
      if (err) return enviarError(res, err);

      if (!reciboRes.length) {
        return res.status(404).json({
          ok: false,
          message: 'Recibo no encontrado'
        });
      }

      const recibo = reciboRes[0];

      db.query(
        `SELECT
           oi.producto_id,
           oi.cantidad,
           oi.precio_unitario,
           oi.subtotal,
           p.nombre
         FROM orden_items oi
         INNER JOIN productos p ON oi.producto_id = p.id
         WHERE oi.orden_id = ?
         ORDER BY oi.id ASC`,
        [orden_id],
        (err2, itemsRes) => {
          if (err2) return enviarError(res, err2);

          db.query(
            `SELECT id
             FROM facturas
             WHERE orden_id = ?
             LIMIT 1`,
            [orden_id],
            (err3, facturaRes) => {
              if (err3) return enviarError(res, err3);

              return res.json({
                ok: true,
                recibo: {
                  ...recibo,
                  pedido: `PED-${recibo.orden_id}`,
                  productos: itemsRes,
                  tiene_factura: facturaRes.length > 0
                }
              });
            }
          );
        }
      );
    }
  );
});

app.post('/api/recibo/enviar-correo', (req, res) => {
  const { orden_id, correo } = req.body;

  if (!orden_id || !correo) {
    return res.status(400).json({
      ok: false,
      message: 'Faltan datos para enviar el recibo'
    });
  }

  db.query(
    `SELECT *
     FROM recibos
     WHERE orden_id = ?
     LIMIT 1`,
    [orden_id],
    (err, reciboRes) => {
      if (err) return enviarError(res, err);

      if (!reciboRes.length) {
        return res.status(404).json({
          ok: false,
          message: 'Recibo no encontrado'
        });
      }

      const recibo = reciboRes[0];

      db.query(
        `SELECT
           oi.producto_id,
           oi.cantidad,
           oi.precio_unitario,
           oi.subtotal,
           p.nombre
         FROM orden_items oi
         INNER JOIN productos p ON oi.producto_id = p.id
         WHERE oi.orden_id = ?
         ORDER BY oi.id ASC`,
        [orden_id],
        async (err2, itemsRes) => {
          if (err2) return enviarError(res, err2);

          try {
            const productosHtml = itemsRes.map(item => `
              <tr>
                <td style="padding:8px;border:1px solid #ddd;">${item.nombre}</td>
                <td style="padding:8px;border:1px solid #ddd;">${item.cantidad}</td>
                <td style="padding:8px;border:1px solid #ddd;">$${Number(item.precio_unitario || 0).toFixed(2)}</td>
                <td style="padding:8px;border:1px solid #ddd;">$${Number(item.subtotal || 0).toFixed(2)}</td>
              </tr>
            `).join('');

            const html = `
              <div style="font-family:Arial,sans-serif;color:#111;">
                <h2>Ballers - Recibo de compra</h2>
                <p><strong>Folio:</strong> ${recibo.folio}</p>
                <p><strong>Pedido:</strong> PED-${recibo.orden_id}</p>
                <p><strong>Cliente:</strong> ${recibo.cliente_nombre}</p>
                <p><strong>Método de pago:</strong> ${recibo.metodo_pago}</p>

                <h3>Productos</h3>
                <table style="border-collapse:collapse;width:100%;">
                  <thead>
                    <tr>
                      <th style="padding:8px;border:1px solid #ddd;">Producto</th>
                      <th style="padding:8px;border:1px solid #ddd;">Cantidad</th>
                      <th style="padding:8px;border:1px solid #ddd;">Precio</th>
                      <th style="padding:8px;border:1px solid #ddd;">Subtotal</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${productosHtml}
                  </tbody>
                </table>

                <h3>Totales</h3>
                <p><strong>Subtotal:</strong> $${Number(recibo.subtotal || 0).toFixed(2)}</p>
                <p><strong>${recibo.impuesto_nombre || 'IVA'} (${Number(recibo.impuesto_porcentaje || 0)}%):</strong> $${Number(recibo.impuesto_monto || 0).toFixed(2)}</p>
                <p><strong>Total:</strong> $${Number(recibo.total || 0).toFixed(2)}</p>
              </div>
            `;

            await enviarCorreo({
              to: correo,
              subject: `Recibo Ballers ${recibo.folio}`,
              html
            });

            return res.json({
              ok: true,
              message: 'Recibo enviado correctamente al correo'
            });
          } catch (mailError) {
            return enviarError(res, mailError, 'No se pudo enviar el correo');
          }
        }
      );
    }
  );
});

/* =========================
   ETAPA 4 - PROMOCIONES
========================= */

/* Obtener todas las promociones */
app.get('/api/promociones', (req, res) => {
  const sql = `
    SELECT
      pr.id,
      pr.nombre,
      pr.tipo_descuento,
      pr.valor_descuento,
      pr.producto_id,
      pr.fecha_inicio,
      pr.fecha_fin,
      pr.estado,
      pr.creado_en,
      pr.actualizado_en,
      p.nombre AS producto_nombre
    FROM promociones pr
    INNER JOIN productos p ON pr.producto_id = p.id
    ORDER BY pr.id DESC
  `;

  db.query(sql, (err, results) => {
    if (err) return enviarError(res, err);

    return res.json({
      ok: true,
      promociones: results
    });
  });
});

/* Obtener promociones activas vigentes para catálogo */
app.get('/api/promociones/activas/catalogo', (req, res) => {
  const sql = `
    SELECT
      pr.id,
      pr.nombre,
      pr.tipo_descuento,
      pr.valor_descuento,
      pr.producto_id,
      pr.fecha_inicio,
      pr.fecha_fin,
      pr.estado
    FROM promociones pr
    WHERE pr.estado = 'activo'
      AND (pr.fecha_inicio IS NULL OR pr.fecha_inicio <= CURDATE())
      AND (pr.fecha_fin IS NULL OR pr.fecha_fin >= CURDATE())
    ORDER BY pr.id DESC
  `;

  db.query(sql, (err, results) => {
    if (err) return enviarError(res, err);

    return res.json({
      ok: true,
      promociones: results
    });
  });
});

/* Obtener promoción por ID */
app.get('/api/promociones/:id', (req, res) => {
  const { id } = req.params;

  const sql = `
    SELECT
      pr.*,
      p.nombre AS producto_nombre
    FROM promociones pr
    INNER JOIN productos p ON pr.producto_id = p.id
    WHERE pr.id = ?
    LIMIT 1
  `;

  db.query(sql, [id], (err, results) => {
    if (err) return enviarError(res, err);

    if (!results.length) {
      return res.status(404).json({
        ok: false,
        message: 'Promoción no encontrada'
      });
    }

    return res.json({
      ok: true,
      promocion: results[0]
    });
  });
});

/* Crear promoción */
/* Crear promoción */
app.post('/api/promociones', (req, res) => {
  const {
    nombre,
    tipo_descuento,
    valor_descuento,
    producto_id,
    fecha_inicio,
    fecha_fin,
    estado
  } = req.body;

  if (!nombre || !tipo_descuento || valor_descuento === undefined || !producto_id || !estado) {
    return res.status(400).json({
      ok: false,
      message: 'Faltan datos obligatorios'
    });
  }

  if (tipo_descuento !== 'porcentaje') {
    return res.status(400).json({
      ok: false,
      message: 'Tipo de descuento no válido'
    });
  }

  const descuentoNum = Number(valor_descuento);
  if (isNaN(descuentoNum) || descuentoNum <= 0 || descuentoNum > 100) {
    return res.status(400).json({
      ok: false,
      message: 'El descuento debe estar entre 1 y 100'
    });
  }

  if (!['activo', 'inactivo'].includes(estado)) {
    return res.status(400).json({
      ok: false,
      message: 'Estado no válido'
    });
  }

  db.query(
    'SELECT id FROM productos WHERE id = ?',
    [producto_id],
    (errProducto, productoRes) => {
      if (errProducto) return enviarError(res, errProducto);

      if (!productoRes.length) {
        return res.status(404).json({
          ok: false,
          message: 'El producto no existe'
        });
      }

      const insertarPromocion = () => {
        const sql = `
          INSERT INTO promociones
          (nombre, tipo_descuento, valor_descuento, producto_id, fecha_inicio, fecha_fin, estado)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `;

        db.query(
          sql,
          [
            nombre,
            tipo_descuento,
            descuentoNum,
            producto_id,
            fecha_inicio || null,
            fecha_fin || null,
            estado
          ],
          (err, result) => {
            if (err) return enviarError(res, err);

            return res.json({
              ok: true,
              message: 'Promoción creada correctamente',
              id: result.insertId
            });
          }
        );
      };

      if (estado === 'activo') {
        db.query(
          `UPDATE promociones
           SET estado = 'inactivo', actualizado_en = NOW()
           WHERE producto_id = ? AND estado = 'activo'`,
          [producto_id],
          (errDesactivar) => {
            if (errDesactivar) return enviarError(res, errDesactivar);
            insertarPromocion();
          }
        );
      } else {
        insertarPromocion();
      }
    }
  );
});

/* Actualizar promoción */
app.put('/api/promociones/:id', (req, res) => {
  const { id } = req.params;
  const {
    nombre,
    tipo_descuento,
    valor_descuento,
    producto_id,
    fecha_inicio,
    fecha_fin,
    estado
  } = req.body;

  if (!nombre || !tipo_descuento || valor_descuento === undefined || !producto_id || !estado) {
    return res.status(400).json({
      ok: false,
      message: 'Faltan datos obligatorios'
    });
  }

  if (tipo_descuento !== 'porcentaje') {
    return res.status(400).json({
      ok: false,
      message: 'Tipo de descuento no válido'
    });
  }

  const descuentoNum = Number(valor_descuento);
  if (isNaN(descuentoNum) || descuentoNum <= 0 || descuentoNum > 100) {
    return res.status(400).json({
      ok: false,
      message: 'El descuento debe estar entre 1 y 100'
    });
  }

  if (!['activo', 'inactivo'].includes(estado)) {
    return res.status(400).json({
      ok: false,
      message: 'Estado no válido'
    });
  }

  db.query(
    'SELECT id FROM productos WHERE id = ?',
    [producto_id],
    (errProducto, productoRes) => {
      if (errProducto) return enviarError(res, errProducto);

      if (!productoRes.length) {
        return res.status(404).json({
          ok: false,
          message: 'El producto no existe'
        });
      }

      const actualizarPromocion = () => {
        const sql = `
          UPDATE promociones
          SET nombre = ?, tipo_descuento = ?, valor_descuento = ?, producto_id = ?,
              fecha_inicio = ?, fecha_fin = ?, estado = ?, actualizado_en = NOW()
          WHERE id = ?
        `;

        db.query(
          sql,
          [
            nombre,
            tipo_descuento,
            descuentoNum,
            producto_id,
            fecha_inicio || null,
            fecha_fin || null,
            estado,
            id
          ],
          (err, result) => {
            if (err) return enviarError(res, err);

            if (result.affectedRows === 0) {
              return res.status(404).json({
                ok: false,
                message: 'Promoción no encontrada'
              });
            }

            return res.json({
              ok: true,
              message: 'Promoción actualizada correctamente'
            });
          }
        );
      };

      if (estado === 'activo') {
        db.query(
          `UPDATE promociones
           SET estado = 'inactivo', actualizado_en = NOW()
           WHERE producto_id = ? AND id <> ? AND estado = 'activo'`,
          [producto_id, id],
          (errDesactivar) => {
            if (errDesactivar) return enviarError(res, errDesactivar);
            actualizarPromocion();
          }
        );
      } else {
        actualizarPromocion();
      }
    }
  );
});

/* Eliminar promoción */
app.delete('/api/promociones/:id', (req, res) => {
  const { id } = req.params;

  db.query(
    'DELETE FROM promociones WHERE id = ?',
    [id],
    (err, result) => {
      if (err) return enviarError(res, err);

      if (result.affectedRows === 0) {
        return res.status(404).json({
          ok: false,
          message: 'Promoción no encontrada'
        });
      }

      return res.json({
        ok: true,
        message: 'Promoción eliminada correctamente'
      });
    }
  );
});

/* =========================
   ETAPA 4 - COMPRAS
========================= */
app.get('/api/compras/:cliente_id', (req, res) => {
  const { cliente_id } = req.params;

  const sql = `
    SELECT
      o.id AS orden_id,
      o.fecha,
      o.estado,
      o.total,
      oi.producto_id,
      oi.cantidad,
      oi.precio_unitario,
      oi.subtotal,
      p.nombre,
      p.descripcion,
      p.categoria,
      p.imagen_url,
      CASE
        WHEN f.id IS NOT NULL THEN 1
        ELSE 0
      END AS tiene_factura
    FROM ordenes_empresariales o
    INNER JOIN orden_items oi ON o.id = oi.orden_id
    INNER JOIN productos p ON oi.producto_id = p.id
    LEFT JOIN facturas f ON o.id = f.orden_id
    WHERE o.cliente_id = ?
    ORDER BY o.id DESC, oi.id ASC
  `;

  db.query(sql, [cliente_id], (err, results) => {
    if (err) return enviarError(res, err);

    return res.json({
      ok: true,
      compras: results
    });
  });
});

/* =========================
   ETAPA 4 - AYUDA Y SOPORTE
========================= */

/* Crear solicitud de soporte */
app.post('/api/soporte', (req, res) => {
  const {
    cliente_id,
    orden_id,
    producto_id,
    tipo_solicitud,
    asunto,
    descripcion,
    prioridad
  } = req.body;

  if (!cliente_id || !tipo_solicitud || !asunto || !descripcion) {
    return res.status(400).json({
      ok: false,
      message: 'Faltan datos obligatorios para crear la solicitud'
    });
  }

  const tiposValidos = [
    'problema_producto',
    'problema_pedido',
    'problema_pago',
    'factura',
    'envio_seguimiento',
    'otro'
  ];

  const prioridadesValidas = ['baja', 'media', 'alta'];

  if (!tiposValidos.includes(tipo_solicitud)) {
    return res.status(400).json({
      ok: false,
      message: 'Tipo de solicitud no válido'
    });
  }

  const prioridadFinal = prioridadesValidas.includes(prioridad) ? prioridad : 'media';

  db.query(
    'SELECT id, nombre, correo FROM clientes WHERE id = ? LIMIT 1',
    [cliente_id],
    (errCliente, clienteRes) => {
      if (errCliente) return enviarError(res, errCliente);

      if (!clienteRes.length) {
        return res.status(404).json({
          ok: false,
          message: 'Cliente no encontrado'
        });
      }

      const sql = `
        INSERT INTO soporte_cliente (
          cliente_id,
          orden_id,
          producto_id,
          tipo_solicitud,
          asunto,
          descripcion,
          prioridad,
          estado
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'por_resolver')
      `;

      db.query(
        sql,
        [
          cliente_id,
          orden_id || null,
          producto_id || null,
          tipo_solicitud,
          asunto,
          descripcion,
          prioridadFinal
        ],
        (err, result) => {
          if (err) return enviarError(res, err);

          return res.json({
            ok: true,
            message: 'Solicitud creada correctamente',
            solicitud_id: result.insertId,
            folio: `SUP-${result.insertId}`
          });
        }
      );
    }
  );
});

/* Ver solicitudes de un cliente */
app.get('/api/soporte/cliente/:cliente_id', (req, res) => {
  const { cliente_id } = req.params;

  const sql = `
    SELECT
      s.id,
      s.cliente_id,
      s.orden_id,
      s.producto_id,
      s.tipo_solicitud,
      s.asunto,
      s.descripcion,
      s.prioridad,
      s.estado,
      s.respuesta_admin,
      s.creado_en,
      s.actualizado_en,
      p.nombre AS producto_nombre
    FROM soporte_cliente s
    LEFT JOIN productos p ON s.producto_id = p.id
    WHERE s.cliente_id = ?
    ORDER BY s.id DESC
  `;

  db.query(sql, [cliente_id], (err, results) => {
    if (err) return enviarError(res, err);

    return res.json({
      ok: true,
      solicitudes: results
    });
  });
});

/* Ver todas las solicitudes para interno */
app.get('/api/soporte', (req, res) => {
  const sql = `
    SELECT
      s.id,
      s.cliente_id,
      s.orden_id,
      s.producto_id,
      s.tipo_solicitud,
      s.asunto,
      s.descripcion,
      s.prioridad,
      s.estado,
      s.respuesta_admin,
      s.creado_en,
      s.actualizado_en,
      c.nombre AS cliente_nombre,
      c.correo AS cliente_correo,
      p.nombre AS producto_nombre
    FROM soporte_cliente s
    INNER JOIN clientes c ON s.cliente_id = c.id
    LEFT JOIN productos p ON s.producto_id = p.id
    ORDER BY
      CASE
        WHEN s.estado = 'por_resolver' THEN 1
        WHEN s.estado = 'en_proceso' THEN 2
        WHEN s.estado = 'resuelto' THEN 3
        ELSE 4
      END,
      s.id DESC
  `;

  db.query(sql, (err, results) => {
    if (err) return enviarError(res, err);

    return res.json({
      ok: true,
      solicitudes: results
    });
  });
});

/* Ver una solicitud individual */
app.get('/api/soporte/:id', (req, res) => {
  const { id } = req.params;

  const sql = `
    SELECT
      s.id,
      s.cliente_id,
      s.orden_id,
      s.producto_id,
      s.tipo_solicitud,
      s.asunto,
      s.descripcion,
      s.prioridad,
      s.estado,
      s.respuesta_admin,
      s.creado_en,
      s.actualizado_en,
      c.nombre AS cliente_nombre,
      c.correo AS cliente_correo,
      p.nombre AS producto_nombre
    FROM soporte_cliente s
    INNER JOIN clientes c ON s.cliente_id = c.id
    LEFT JOIN productos p ON s.producto_id = p.id
    WHERE s.id = ?
    LIMIT 1
  `;

  db.query(sql, [id], (err, results) => {
    if (err) return enviarError(res, err);

    if (!results.length) {
      return res.status(404).json({
        ok: false,
        message: 'Solicitud no encontrada'
      });
    }

    return res.json({
      ok: true,
      solicitud: results[0]
    });
  });
});

/* Actualizar estado y respuesta de una solicitud */
app.put('/api/soporte/:id', (req, res) => {
  const { id } = req.params;
  const { estado, respuesta_admin } = req.body;

  const estadosValidos = ['por_resolver', 'en_proceso', 'resuelto'];

  if (!estado || !estadosValidos.includes(estado)) {
    return res.status(400).json({
      ok: false,
      message: 'Estado no válido'
    });
  }

  db.query(
    `
    SELECT
      s.id,
      s.asunto,
      s.estado,
      c.nombre AS cliente_nombre,
      c.correo AS cliente_correo
    FROM soporte_cliente s
    INNER JOIN clientes c ON s.cliente_id = c.id
    WHERE s.id = ?
    LIMIT 1
    `,
    [id],
    (errBusca, solicitudRes) => {
      if (errBusca) return enviarError(res, errBusca);

      if (!solicitudRes.length) {
        return res.status(404).json({
          ok: false,
          message: 'Solicitud no encontrada'
        });
      }

      const solicitud = solicitudRes[0];

      db.query(
        `
        UPDATE soporte_cliente
        SET estado = ?, respuesta_admin = ?, actualizado_en = NOW()
        WHERE id = ?
        `,
        [estado, respuesta_admin || null, id],
        async (errUpdate, result) => {
          if (errUpdate) return enviarError(res, errUpdate);

          if (result.affectedRows === 0) {
            return res.status(404).json({
              ok: false,
              message: 'No se pudo actualizar la solicitud'
            });
          }

          try {
            if (
              estado === 'resuelto' &&
              solicitud.cliente_correo
            ) {
              const respuestaTexto = respuesta_admin
                ? respuesta_admin
                : 'Tu solicitud fue marcada como resuelta por el equipo de Ballers.';

              const html = `
                <div style="font-family:Arial,sans-serif;color:#111;">
                  <h2>Ballers - Solicitud resuelta</h2>
                  <p>Hola <strong>${solicitud.cliente_nombre || 'cliente'}</strong>,</p>
                  <p>Tu solicitud de ayuda y soporte ya fue marcada como <strong>resuelta</strong>.</p>

                  <p><strong>Folio:</strong> SUP-${solicitud.id}</p>
                  <p><strong>Asunto:</strong> ${solicitud.asunto || 'Sin asunto'}</p>

                  <h3>Respuesta del equipo</h3>
                  <p>${respuestaTexto}</p>

                  <p>Gracias por comunicarte con Ballers.</p>
                </div>
              `;

              await enviarCorreo({
                to: solicitud.cliente_correo,
                subject: `Ballers - Solicitud resuelta SUP-${solicitud.id}`,
                html
              });
            }

            return res.json({
              ok: true,
              message: 'Solicitud actualizada correctamente'
            });
          } catch (mailError) {
            return enviarError(res, mailError, 'La solicitud se actualizó, pero no se pudo enviar el correo');
          }
        }
      );
    }
  );
});

/* =========================
   ETAPA 4 - PERFIL CLIENTE
========================= */

/* Obtener perfil del cliente por cliente_id */
app.get('/api/perfil/:cliente_id', (req, res) => {
  const { cliente_id } = req.params;

  const sql = `
    SELECT
      c.id AS cliente_id,
      u.id AS usuario_id,
      u.nombre,
      u.correo,
      u.tipo_cuenta,
      u.rol,
      c.telefono,
      c.empresa
    FROM clientes c
    INNER JOIN usuarios u ON c.correo = u.correo
    WHERE c.id = ?
    LIMIT 1
  `;

  db.query(sql, [cliente_id], (err, results) => {
    if (err) return enviarError(res, err);

    if (!results.length) {
      return res.status(404).json({
        ok: false,
        message: 'Perfil no encontrado'
      });
    }

    return res.json({
      ok: true,
      perfil: results[0]
    });
  });
});

/* Actualizar datos del perfil por cliente_id */
app.put('/api/perfil/:cliente_id', (req, res) => {
  const { cliente_id } = req.params;
  const { nombre, correo, telefono, empresa } = req.body;

  if (!nombre || !correo) {
    return res.status(400).json({
      ok: false,
      message: 'Nombre y correo son obligatorios'
    });
  }

  const sqlBuscar = `
    SELECT
      c.id AS cliente_id,
      c.correo AS correo_cliente_actual,
      u.id AS usuario_id,
      u.correo AS correo_usuario_actual
    FROM clientes c
    INNER JOIN usuarios u ON c.correo = u.correo
    WHERE c.id = ?
    LIMIT 1
  `;

  db.query(sqlBuscar, [cliente_id], (errBuscar, results) => {
    if (errBuscar) return enviarError(res, errBuscar);

    if (!results.length) {
      return res.status(404).json({
        ok: false,
        message: 'Cliente no encontrado'
      });
    }

    const perfilActual = results[0];

    db.query(
      'SELECT id FROM usuarios WHERE correo = ? AND id <> ? LIMIT 1',
      [correo, perfilActual.usuario_id],
      (errCorreo, correoRes) => {
        if (errCorreo) return enviarError(res, errCorreo);

        if (correoRes.length) {
          return res.status(400).json({
            ok: false,
            message: 'Ese correo ya está registrado por otro usuario'
          });
        }

        db.query(
          'UPDATE usuarios SET nombre = ?, correo = ? WHERE id = ?',
          [nombre, correo, perfilActual.usuario_id],
          (errUpdateUser) => {
            if (errUpdateUser) return enviarError(res, errUpdateUser);

            db.query(
              'UPDATE clientes SET nombre = ?, correo = ?, telefono = ?, empresa = ? WHERE id = ?',
              [
                nombre,
                correo,
                telefono || null,
                empresa || null,
                cliente_id
              ],
              (errUpdateCliente) => {
                if (errUpdateCliente) return enviarError(res, errUpdateCliente);

                return res.json({
                  ok: true,
                  message: 'Perfil actualizado correctamente'
                });
              }
            );
          }
        );
      }
    );
  });
});

/* Cambiar contraseña por cliente_id */
app.put('/api/perfil/:cliente_id/password', (req, res) => {
  const { cliente_id } = req.params;
  const { password_actual, password_nueva } = req.body;

  if (!password_actual || !password_nueva) {
    return res.status(400).json({
      ok: false,
      message: 'Faltan datos para actualizar la contraseña'
    });
  }

  if (String(password_nueva).length < 6) {
    return res.status(400).json({
      ok: false,
      message: 'La nueva contraseña debe tener al menos 6 caracteres'
    });
  }

  const sqlBuscar = `
    SELECT
      c.id AS cliente_id,
      u.id AS usuario_id,
      u.password
    FROM clientes c
    INNER JOIN usuarios u ON c.correo = u.correo
    WHERE c.id = ?
    LIMIT 1
  `;

  db.query(sqlBuscar, [cliente_id], async (errBuscar, results) => {
    if (errBuscar) return enviarError(res, errBuscar);

    if (!results.length) {
      return res.status(404).json({
        ok: false,
        message: 'Cliente no encontrado'
      });
    }

    const perfil = results[0];
    const coincide = await bcrypt.compare(password_actual, perfil.password);

    if (!coincide) {
      return res.status(400).json({
        ok: false,
        message: 'La contraseña actual no es correcta'
      });
    }

    const hash = await bcrypt.hash(password_nueva, 10);

    db.query(
      'UPDATE usuarios SET password = ? WHERE id = ?',
      [hash, perfil.usuario_id],
      (errUpdate) => {
        if (errUpdate) return enviarError(res, errUpdate);

        return res.json({
          ok: true,
          message: 'Contraseña actualizada correctamente'
        });
      }
    );
  });
});

/* =========================
   ETAPA 4 - SEGUIMIENTO CLIENTE
========================= */
app.get('/api/seguimiento/:cliente_id', (req, res) => {
  const { cliente_id } = req.params;

  const sql = `
    SELECT
      o.id AS orden_id,
      o.fecha,
      o.total,
      sp.estado AS seguimiento_estado,
      sp.comentario,
      sp.actualizado_en
    FROM ordenes_empresariales o
    LEFT JOIN seguimiento_pedidos sp ON o.id = sp.orden_id
    WHERE o.cliente_id = ?
    ORDER BY o.id DESC
  `;

  db.query(sql, [cliente_id], (err, results) => {
    if (err) return enviarError(res, err);

    return res.json({
      ok: true,
      pedidos: results
    });
  });
});

/* =========================
   ETAPA 4 - SEGUIMIENTO INTERNO
========================= */
app.get('/api/interno/seguimiento', (req, res) => {
  const sql = `
    SELECT
      sp.id,
      sp.orden_id,
      sp.estado,
      sp.comentario,
      sp.actualizado_en,
      o.fecha,
      o.total,
      c.id AS cliente_id,
      c.nombre AS cliente_nombre,
      c.correo AS cliente_correo
    FROM seguimiento_pedidos sp
    INNER JOIN ordenes_empresariales o ON sp.orden_id = o.id
    INNER JOIN clientes c ON o.cliente_id = c.id
    ORDER BY sp.actualizado_en DESC, sp.id DESC
  `;

  db.query(sql, (err, results) => {
    if (err) return enviarError(res, err);

    return res.json({
      ok: true,
      seguimientos: results
    });
  });
});

app.put('/api/interno/seguimiento/:orden_id', (req, res) => {
  const { orden_id } = req.params;
  const { estado, comentario } = req.body;

  const estadosValidos = ['preparacion', 'en_camino', 'entregado'];

  if (!estado || !estadosValidos.includes(estado)) {
    return res.status(400).json({
      ok: false,
      message: 'Estado no válido'
    });
  }

  db.query(
    `UPDATE seguimiento_pedidos
     SET estado = ?, comentario = ?, actualizado_en = NOW()
     WHERE orden_id = ?`,
    [estado, comentario || null, orden_id],
    (err, result) => {
      if (err) return enviarError(res, err);

      if (result.affectedRows === 0) {
        return res.status(404).json({
          ok: false,
          message: 'Seguimiento no encontrado'
        });
      }

      return res.json({
        ok: true,
        message: 'Seguimiento actualizado correctamente'
      });
    }
  );
});

/* =========================
   INICIAR SERVIDOR
========================= */
app.listen(PORT, () => {
  console.log(`Servidor corriendo en http://localhost:${PORT}`);
});