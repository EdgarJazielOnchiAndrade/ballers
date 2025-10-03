# ADR-001 — Plataforma abierta (o híbrida) para el e-commerce

- **Estado:** Aprobado  
- **Fecha:** 2025-10-02  
- **Contexto:** El proyecto del curso es 100% front-end (HTML/CSS/JS) con datos en `src/assets/data/products.json`. En un despliegue real se requiere vender en línea con catálogo, carrito, checkout y administración de órdenes.

## Decisión
Adoptar una **plataforma abierta** (preferencia: **WordPress + WooCommerce** o **PrestaShop**) conectada a nuestro front (hoy simulado). Mantener la opción **híbrida**: UI propia + API de la plataforma, para poder cambiar de backend sin rehacer la interfaz.

## Opciones consideradas
- **Abiertas:** WooCommerce, PrestaShop.  
- **Cerradas/SaaS:** Shopify, Tiendanube.

## Justificación (beneficios)
- **Menor lock-in:** datos exportables y backend reemplazable.  
- **Flexibilidad:** plugins/módulos, temas y control de hosting.  
- **Costo predecible:** hosting + mantenimiento vs. comisiones variables.  
- **Comunidad y documentación** amplias.

## Riesgos y mitigaciones
- **Mantenimiento/seguridad:** actualizaciones automáticas, backups, hardening del servidor.
- **Curva técnica:** guías internas, ambiente de pruebas (Docker/Local), checklist de deploy.
- **Performance:** CDN, cache, optimización de imágenes/JS; pruebas Lighthouse.

## Consecuencias
- Más control implica más responsabilidad operativa.  
- El front queda desacoplado: podremos migrar de WooCommerce a PrestaShop (o a SaaS) cambiando sólo la capa de integración (API).

## Evidencia en el curso
- Catálogo renderizado desde `products.json`.
- Página **Tecnología propuesta** con simulaciones de integración (Woo/Presta/Shopify/Tiendanube).
