const mongoose = require('mongoose');
mongoose.connect('mongodb://127.0.0.1:27017/email_sequencing').then(async () => {
  const seq = await mongoose.connection.collection('sequences').findOne({ name: 'Resignation' });
  console.log(seq);
  process.exit();
});
