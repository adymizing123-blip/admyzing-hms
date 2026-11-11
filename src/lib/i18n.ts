/**
 * English -> Spanish dictionary for the public website and patient portal.
 * Keys are the English text, so untranslated text simply shows in English.
 */
export type Lang = 'en' | 'es';

export const translations: Record<string, string> = {
  // header / footer
  'Home': 'Inicio', 'Departments': 'Departamentos', 'Doctors': 'Médicos', 'Lab Tests': 'Análisis', 'Store': 'Tienda', 'Contact': 'Contacto',
  'Book Appointment': 'Reservar cita', 'Book now': 'Reservar', 'Call': 'Llamar', 'Sign in': 'Iniciar sesión', 'My Portal': 'Mi portal',
  '24/7 Emergency:': 'Emergencias 24/7:', 'Mon to Sat, 8:00 AM to 8:00 PM outpatient clinics': 'Consultas de lunes a sábado, 8:00 a. m. a 8:00 p. m.',
  'Patients': 'Pacientes', 'Hospital': 'Hospital', 'Book an appointment': 'Reservar una cita', 'Patient portal': 'Portal del paciente',
  'Lab tests & prices': 'Análisis y precios', 'Health store': 'Tienda de salud', 'Our doctors': 'Nuestros médicos', 'Contact us': 'Contáctenos',
  'Staff login': 'Acceso del personal', 'All rights reserved.': 'Todos los derechos reservados.', 'Request ambulance transport': 'Solicitar traslado en ambulancia',
  'Compassionate, modern healthcare for the whole family. Board-certified specialists, on-site lab and pharmacy, 24/7 emergency care.':
    'Atención médica moderna y humana para toda la familia. Especialistas certificados, laboratorio y farmacia en el hospital, emergencias 24/7.',
  // home
  'Board-certified specialists': 'Especialistas certificados', 'Expert care,': 'Atención experta,', 'close to home.': 'cerca de casa.',
  'Book a visit in under a minute, get lab results online and order health essentials from our pharmacy. All in one place.':
    'Reserve una consulta en menos de un minuto, vea sus resultados en línea y pida productos de salud en nuestra farmacia. Todo en un solo lugar.',
  'Find a Doctor': 'Buscar médico', 'Specialties': 'Especialidades', 'Emergency': 'Emergencias', 'Beds': 'Camas',
  'Emergency 24/7': 'Emergencias 24/7', 'Walk in any time': 'Atención sin cita a cualquier hora',
  'Online Booking': 'Citas en línea', 'Pick a doctor and a time slot that suits you.': 'Elija un médico y el horario que le convenga.',
  'Lab & Imaging': 'Laboratorio e imágenes', 'On-site lab, X-ray, ultrasound and MRI.': 'Laboratorio, rayos X, ultrasonido y resonancia en el hospital.',
  'Pharmacy & Store': 'Farmacia y tienda', 'Medicines, devices and supplements delivered.': 'Medicamentos, equipos y suplementos a domicilio.',
  'Patient Portal': 'Portal del paciente', 'Prescriptions, reports and bills online.': 'Recetas, resultados y facturas en línea.',
  'Care for every stage of life': 'Atención para cada etapa de la vida', 'View all departments →': 'Ver todos los departamentos →',
  'Our team': 'Nuestro equipo', 'Meet our specialists': 'Conozca a nuestros especialistas', 'All doctors →': 'Todos los médicos →',
  'Health packages': 'Paquetes de salud', 'Preventive checkups, one simple price': 'Chequeos preventivos a un precio único', 'Book package': 'Reservar paquete',
  'Need to see a doctor?': '¿Necesita ver a un médico?', 'Same-day appointments available.': 'Citas disponibles el mismo día.',
  // departments / doctors / lab
  'Specialized teams working together for your health.': 'Equipos especializados trabajando juntos por su salud.', 'View doctors': 'Ver médicos', 'doctor(s)': 'médico(s)',
  'Our Doctors': 'Nuestros médicos', 'Choose a specialist and book a time that works for you.': 'Elija un especialista y reserve el horario que le convenga.',
  'All': 'Todos', 'No doctors found in this department.': 'No hay médicos en este departamento.', 'Book': 'Reservar', '/ visit': '/ consulta',
  'Lab Tests & Imaging': 'Análisis e imágenes', 'Transparent self-pay prices. Results are available in your patient portal.': 'Precios claros para pago directo. Los resultados aparecen en su portal del paciente.',
  'Results in': 'Resultados en',
  // store / cart
  'Health Store': 'Tienda de salud', 'Devices, supplements, first aid and health packages. Ships within the US.': 'Equipos, suplementos, primeros auxilios y paquetes de salud. Envíos dentro de EE. UU.',
  'Search products...': 'Buscar productos...', 'No products found.': 'No se encontraron productos.', 'Add to cart': 'Agregar al carrito', 'Added': 'Agregado', 'Out of stock': 'Agotado',
  '← Back to store': '← Volver a la tienda', 'In stock': 'Disponible', 'Free shipping on orders over $75': 'Envío gratis en pedidos de más de $75',
  'Dispensed by our licensed hospital pharmacy': 'Despachado por nuestra farmacia hospitalaria autorizada',
  'Your cart is empty': 'Su carrito está vacío', 'Browse the store': 'Ver la tienda', 'Cart & checkout': 'Carrito y pago', 'Shipping details': 'Datos de envío',
  'Full name': 'Nombre completo', 'Email': 'Correo electrónico', 'Phone': 'Teléfono', 'Street address': 'Dirección', 'City': 'Ciudad', 'State': 'Estado', 'ZIP': 'Código postal',
  'Subtotal': 'Subtotal', 'Shipping': 'Envío', 'Free': 'Gratis', 'Sales tax': 'Impuesto', 'Calculated at payment': 'Se calcula al pagar', 'Total': 'Total',
  'Proceed to payment': 'Continuar al pago', 'Thank you for your order!': '¡Gracias por su pedido!', 'Order': 'Pedido',
  'Online payment is not set up yet, so you can pay when the order is delivered or picked up.': 'El pago en línea aún no está activo; puede pagar al recibir o recoger el pedido.',
  'A confirmation email is on its way.': 'Le enviamos un correo de confirmación.', 'Continue shopping': 'Seguir comprando', 'View my orders': 'Ver mis pedidos',
  // booking
  'Book an appointment ': 'Reservar una cita ', 'Doctor': 'Médico', 'Date & time': 'Fecha y hora', 'Your details': 'Sus datos', 'Confirmed': 'Confirmada', 'Back': 'Atrás',
  'All departments': 'Todos los departamentos', 'Visit type': 'Tipo de consulta', 'At the hospital': 'En el hospital', 'Video visit': 'Videoconsulta',
  'You will get a secure video link. Join from your phone or computer, no app needed.': 'Recibirá un enlace seguro de video. Únase desde su teléfono o computadora, sin instalar nada.',
  'Choose a date': 'Elija una fecha', 'Available times': 'Horarios disponibles', 'No slots left on this day.': 'No quedan horarios este día.', 'Continue': 'Continuar',
  'First name': 'Nombre', 'Last name': 'Apellido', 'Date of birth': 'Fecha de nacimiento', 'Reason for visit': 'Motivo de la consulta',
  'Have an account?': '¿Tiene una cuenta?', 'to see this visit in your portal.': 'para ver esta consulta en su portal.', 'Confirm booking': 'Confirmar cita',
  'You are booked!': '¡Su cita está reservada!', 'Your video visit link': 'Su enlace de videoconsulta', 'Token number': 'Número de turno',
  'Open the link a few minutes before your time. It is also in your patient portal.': 'Abra el enlace unos minutos antes de su hora. También está en su portal del paciente.',
  'Please arrive 10 minutes early and bring your photo ID and insurance card.': 'Llegue 10 minutos antes y traiga su identificación con foto y su tarjeta del seguro.',
  'Back to home': 'Volver al inicio', 'Go to my portal': 'Ir a mi portal', 'Create an account': 'Crear una cuenta',
  // contact
  'Questions about appointments, billing or insurance? We usually reply within one business day.': '¿Preguntas sobre citas, facturas o seguros? Normalmente respondemos en un día hábil.',
  'Address': 'Dirección', 'Hours': 'Horario', 'Name': 'Nombre', 'Topic': 'Tema', 'Clinic': 'Clínica', 'Any clinic': 'Cualquier clínica', 'Message': 'Mensaje', 'Send message': 'Enviar mensaje',
  'Message received': 'Mensaje recibido', 'Our team will get back to you shortly.': 'Nuestro equipo le responderá pronto.',
  'General inquiry': 'Consulta general', 'Appointments': 'Citas', 'Billing & insurance': 'Facturación y seguros', 'Store order': 'Pedido de la tienda', 'Careers': 'Empleo',
  // ambulance request
  'Non-emergency ambulance transport': 'Traslado en ambulancia (no urgente)', 'Emergency? Call 911 now.': '¿Es una emergencia? Llame al 911 ahora.',
  'For hospital transfers, discharges and rides to appointments. We will call you to confirm.': 'Para traslados entre hospitales, altas y viajes a citas. Le llamaremos para confirmar.',
  'Pickup address': 'Dirección de recogida', 'Destination': 'Destino', 'Pickup date & time': 'Fecha y hora de recogida', 'Notes (mobility, oxygen, wheelchair...)': 'Notas (movilidad, oxígeno, silla de ruedas...)',
  'Request transport': 'Solicitar traslado', 'Request received': 'Solicitud recibida', 'Reference': 'Referencia', 'We will call you shortly to confirm.': 'Le llamaremos pronto para confirmar.',
  // login
  'Welcome back': 'Bienvenido de nuevo', 'Create your account': 'Cree su cuenta', 'Reset your password': 'Restablecer contraseña',
  'Sign in to your patient portal or staff dashboard.': 'Ingrese a su portal del paciente o al panel del personal.',
  'Access appointments, reports and orders online.': 'Vea sus citas, resultados y pedidos en línea.', 'Enter your email and we will send you a reset link.': 'Escriba su correo y le enviaremos un enlace.',
  'Password': 'Contraseña', 'Forgot password?': '¿Olvidó su contraseña?', 'Send reset link': 'Enviar enlace', 'Create account': 'Crear cuenta',
  'New patient? ': '¿Paciente nuevo? ', 'Remembered it? ': '¿La recordó? ', 'Already have an account? ': '¿Ya tiene una cuenta? ',
  // portal
  'Hi,': 'Hola,', 'Upcoming visits': 'Próximas citas', 'Past visits': 'Consultas anteriores', 'Lab results': 'Resultados', 'Balance due': 'Saldo pendiente',
  'Visits & Prescriptions': 'Consultas y recetas', 'Lab Results': 'Resultados', 'Bills': 'Facturas', 'Store Orders': 'Pedidos', 'My Profile': 'Mi perfil',
  'Messages': 'Mensajes', 'Documents': 'Documentos', 'Immunizations': 'Vacunas', 'Book visit': 'Reservar cita', 'Sign out': 'Cerrar sesión',
  'No appointments yet.': 'Aún no tiene citas.', 'Cancel': 'Cancelar', 'Join video': 'Unirse al video', 'Book a new appointment': 'Reservar nueva cita',
  'No visit records yet.': 'Aún no hay consultas registradas.', 'Diagnosis:': 'Diagnóstico:', 'Follow-up on': 'Seguimiento el',
  'Medicine': 'Medicamento', 'Dosage': 'Dosis', 'Frequency': 'Frecuencia', 'Duration': 'Duración', 'Request refill': 'Pedir resurtido', 'Refill requested': 'Resurtido solicitado',
  'No lab orders yet.': 'Aún no hay análisis.', 'Results will appear here once completed.': 'Los resultados aparecerán aquí cuando estén listos.',
  'No bills yet.': 'Aún no hay facturas.', 'Paid': 'Pagado', 'Pay now': 'Pagar ahora', 'No store orders yet.': 'Aún no hay pedidos.',
  'Personal & insurance details': 'Datos personales y del seguro', 'Save changes': 'Guardar cambios', 'Profile saved.': 'Perfil guardado.',
  'Insurance provider': 'Aseguradora', 'Member ID': 'Número de afiliado', 'Emergency contact': 'Contacto de emergencia', 'Emergency phone': 'Teléfono de emergencia',
  'Do not send me health tips and offers': 'No deseo recibir consejos ni ofertas',
  'Send a message to your care team': 'Envíe un mensaje a su equipo médico', 'Care team (general)': 'Equipo médico (general)', 'Type your message...': 'Escriba su mensaje...',
  'Send': 'Enviar', 'For emergencies call 911. Messages are answered during clinic hours.': 'En caso de emergencia llame al 911. Los mensajes se responden en horario de consulta.',
  'No messages yet.': 'Aún no hay mensajes.', 'Upload a document': 'Subir documento', 'No documents yet.': 'Aún no hay documentos.', 'View': 'Ver',
  'Upload insurance cards, outside lab results or referral letters.': 'Suba tarjetas del seguro, resultados de otros laboratorios o cartas de referencia.',
  'No immunizations on record.': 'No hay vacunas registradas.', 'Next dose due': 'Próxima dosis', 'Dose': 'Dosis',
  'Refill requests': 'Solicitudes de resurtido', 'Pending': 'Pendiente', 'Approved': 'Aprobado', 'Denied': 'Rechazado', 'Dispensed': 'Entregado',
  'Language': 'Idioma',
};

export function t(lang: Lang | string | undefined, key: string): string {
  if (lang !== 'es') return key;
  return translations[key] ?? key;
}
