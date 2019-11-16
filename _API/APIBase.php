<?php
namespace API;
if ( session_status() ===  PHP_SESSION_NONE) { 
    session_start();
}
//header("Access-Control-Allow-Origin: *");
header("Content-Type: application/json; charset=UTF-8");

class APIBase {
    
    function __construct(){
        $RequestMethod = $_SERVER['REQUEST_METHOD'];
        $RequestObject;
        switch ($RequestMethod) {
            case 'GET':
                $RequestObject = (object) $_GET;
                $this->Get($RequestObject);
                break;
            case 'POST':
                $RequestObject = json_decode(file_get_contents('php://input'), true);
                $this->Post($RequestObject);
                break;
            case 'PUT':
                $RequestObject = json_decode(file_get_contents('php://input'), true);
                $this->Put($RequestObject);
            case 'DELETE':
                $RequestObject = json_decode(file_get_contents('php://input'), true);
                $this->Delete($RequestObject);
            break;
            default:
                break;
        }
    }

    function Post($requestObject){
        echo json_encode($requestObject);
    }

    function Put($requestObject){
        echo json_encode($requestObject);
    }

    function Delete($requestObject){
        echo json_encode($requestObject);
    }

    function Get($requestObject){
        echo json_encode($requestObject);
    }

    function Response($responseCode, $responseBody){
        http_response_code($responseCode);
        echo json_encode($responseBody);
    }
}
?>