const newUserId = ObjectId('507f1f77bcf86cd799439011');
db.sequences.updateMany({_id: ObjectId('6a323381dd044c26b880aa5d')}, { $set: { user_id: newUserId } });
db.sequence_steps.updateMany({sequence_id: ObjectId('6a323381dd044c26b880aa5d')}, { $set: { user_id: newUserId } });
db.sequence_contacts.updateMany({sequence_id: ObjectId('6a323381dd044c26b880aa5d')}, { $set: { user_id: newUserId } });
db.sending_logs.updateMany({sequence_id: ObjectId('6a323381dd044c26b880aa5d')}, { $set: { user_id: newUserId } });
print('Updated user_id to match email connections');
