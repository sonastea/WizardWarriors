DROP TABLE IF EXISTS Entity_Saves;
CREATE TABLE WizardWarriors.Entity_Saves ( 
    ID INT NOT NULL AUTO_INCREMENT,
    UsersID INT NOT NULL,
    MaxLevel INT NOT NULL,
    CreatedOn TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CreatedBy VARCHAR(50) NOT NULL,
    UpdatedOn TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UpdatedBy VARCHAR(50), PRIMARY KEY (ID),
    IsActive bit(1) NOT NULL DEFAULT b'1'
    )