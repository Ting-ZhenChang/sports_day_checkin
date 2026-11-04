-- cheakin_log
IF OBJECT_ID('dbo.CHECKIN_LOG', 'U') IS NULL
BEGIN

    CREATE TABLE dbo.CHECKIN_LOG
    (
        checkin_log_id BIGINT IDENTITY(1,1) NOT NULL,

        employee_no NVARCHAR(30) NOT NULL,         -- 被報到者工號
        seed_code NVARCHAR(100) NULL,              -- 本次掃描種子碼

        operator_employee_no NVARCHAR(30) NOT NULL,-- 操作人 / 負責人工號

        expected_guest_count TINYINT NULL,         -- 原預計眷屬數
        actual_guest_count TINYINT NULL,           -- 實際到場眷屬數
        actual_total_count TINYINT NULL,           -- 員工＋眷屬總人數

        checkin_status BIT NOT NULL
            CONSTRAINT DF_CHECKIN_status DEFAULT 1,

        action_type NVARCHAR(20) NOT NULL
            CONSTRAINT DF_CHECKIN_action DEFAULT N'CHECKIN',
            -- CHECKIN / UPDATE / MANUAL

        checkin_source NVARCHAR(20) NOT NULL
            CONSTRAINT DF_CHECKIN_source DEFAULT N'QR',
            -- QR / MANUAL

        checkin_time DATETIME2(0) NOT NULL
            CONSTRAINT DF_CHECKIN_time DEFAULT SYSDATETIME(),

        update_reason NVARCHAR(255) NULL,           -- HR人工修改原因

        created_at DATETIME2(0) NOT NULL
            CONSTRAINT DF_CHECKIN_created DEFAULT SYSDATETIME(),

        CONSTRAINT PK_CHECKIN_LOG
            PRIMARY KEY (checkin_log_id),

        CONSTRAINT FK_CHECKIN_MASTER
            FOREIGN KEY (employee_no)
            REFERENCES dbo.MASTER_PARTICIPANT(employee_no)
    );

END;
GO

